const parse = require('./lib/parser');
const lexer = require('./lib/lexer');

/* The transpiler itself
    TranspileMachine is almost a VM that reads "opcodes" and converts
    them to Javascript. It is somewhat aware of the scope and generates
    code.
    Transpiler fits it altogether, and returns an object function which
    allows you to feed variables to it.
*/

class TranspileMachine { // Registry for defined variables and code blocks
    blocks = {};
    blockStack = [];
    curBlock = null;
    constructor() {
        this.block('root'); // start root code block
    }
    varname(v) {
        return JSON.stringify(v);
    }
    render() {
        // render code blocks
        let rootBlock, blocks = [];
        for(let block in this.blocks) {
            if(block == 'root') rootBlock = this.blocks[block];
            else blocks.push(this.blocks[block]);
        }
        return blocks.map((b) => `let block_${b.id} = () => {${b.data}}`).join('\n') + '\n' + rootBlock.data;
    }
    block(id = null) {
        // begins a block
        while(!id || this.blocks[id] !== undefined) {
            id = Math.round(Math.random() * 100000000);
        }
        this.blocks[id] = {id: id, data: ''};
        this.blockStack.push(this.blocks[id]);
        this.curBlock = this.blocks[id];
        return 'block_' + id;
    }
    endBlock() {
        // ends a block
        this.blockStack.pop();
        this.curBlock = this.blockStack[this.blockStack.length - 1];
    }
    write(code, depth = 1) {
        // writes code to a block, capable of going up several blocks
        this.blockStack[this.blockStack.length - depth].data += code;
    }
    // Translate opcodes into JS
    translate(opcodes) {
        let ret = '';
        for(let i of opcodes) {
            switch(i[0]) {
                case 'JSV':
                    ret +=('this.__ev(' + this.varname(i[1]) + ')');
                    break;
                case 'DIR': 
                    ret +=(i[1]);
                    break;
                case 'ARG':
                    ret +=(this.translate(i[1]));
                    break;
                case 'NEST':
                    ret +=('(' + this.transpile([{ block: [0, i[1], i[2]] }], true) + ')');
                    break;
                case 'AS':
                    ret +=(',');
                    break;
                case 'EQ':
                    ret +=(':'); // = is only used for the object args
                    break;
            }
        }
        return ret;
    }
    // Transpile blocks into JS
    transpile(blocks, nested = false) {
        let exprStack = [];
        let ret ='';
        const writeBuf = (depth = 1) => {
            this.write(ret, depth);
            ret = '';
        }
        for(let blockHead of blocks) {
            let opts = blockHead.opts || {};
            let block = blockHead.block;

            let printFunc = opts.raw ? '__printRaw' : '__print';

            if(opts.html) {
                ret += 'this.__printHTML(' + blockHead.data + ')\n';
                continue;
            }
            let opcodes = block[1];
            let i, argList;
            switch(block[2]) {
                case 'FUNC':
                    argList = [this.varname(opcodes[0][1])];
                    i = 1;
                    while(opcodes[i][0] == 'ARG') {
                        argList.push(this.translate([opcodes[i]]));
                        i++;
                    }
                    if(nested)
                        ret +=('this.__ev(' + argList.join(',') + ')');
                    else
                        ret +=('this.' + printFunc + '(this.__ev(' + argList.join(',') + '))');
                    break;
                case 'VAR':
                    if(nested)
                        ret +=(this.translate(opcodes));
                    else
                        ret +=('this.' + printFunc + '(' + this.translate(opcodes) + ')');
                    break;
                case 'EACH':
                    exprStack.push('each');
                    ret +=(`this.__each(${this.translate([opcodes[0]])}, "${opcodes[1][0] == 'JSV' ? opcodes[1][1] : 'this'}", ${this.block()})`);
                    writeBuf(2);
                    break;
                case 'WITH':
                    exprStack.push('with');
                    ret +=(`this.__with(${this.translate([opcodes[0]])}, ${this.block()})`);
                    writeBuf(2);
                    break;
                case 'ENDEXPR':
                    let a = exprStack.pop();
                    if(a != opcodes[0][1]) throw 'Unexpected end expression!';
                    if(opcodes[0][1] != 'if') {
                        writeBuf(1);
                        this.endBlock();
                    } else {
                        ret +=( '}');
                    }
                    break;
                case 'IF':
                    exprStack.push('if');
                    ret +=('if(');
                    i = 0;
                    while(opcodes[i][0] != 'END') {
                        if(opcodes[i][0] == 'ARG') {
                            ret +=(this.translate(opcodes[i][1]));
                        } else {
                            ret +=(opcodes[i][1]);
                        }
                        i++;
                    }
                    ret +=('){');
                    break;
                case 'ELSE':
                    if(exprStack[exprStack.length - 1] == 'if' || exprStack[exprStack.length - 1] == 'unless')
                        ret +=('} else {');
                    else
                        ret +=('},() => {');
                    break;
                case 'ELIF':
                    ret +=('} else if(');
                    i = 0;
                    while(opcodes[i][0] != 'END') {
                        if(opcodes[i][0] == 'ARG') {
                            ret +=(this.translate(opcodes[i][1]));
                        } else {
                            ret +=(opcodes[i][1]);
                        }
                        i++;
                    }
                    ret +=('){');
                    break;
                case 'EXPR':
                    exprStack.push(opcodes[0][1]);
                    argList = [];
                    i = 1;
                    while(opcodes[i][0] == 'ARG') {
                        argList.push(this.translate([opcodes[i]]));
                        i++;
                    }
                    ret +=(`this.__runExpr('${opcodes[0][1]}',[${argList.join(',')}], ${this.block()});`);
                    writeBuf(2);
                    break;
                case 'PARTIAL':
                    ret +=(`this.__runPart('${opcodes[0][1]}', ${this.translate([opcodes[1]])})`);
                    break;
                case 'EXPRPART':
                    exprStack.push(opcodes[0][1]);
                    ret +=(`this.__runPart('${opcodes[0][1]}', ${this.block()})`);
                    writeBuf(2);
                    break;
                case 'CREATEPART':
                    exprStack.push('partial');
                    // partials are special as they can either be global or scoped, and are to be added to the beginning
                    let curBlock = this.blockStack[this.blockStack.length - 1];
                    curBlock.data = (`this.__createPart('${opcodes[0][1]}', ${this.block()})\n`) + curBlock.data;
                    writeBuf(2);
                    break;
                case 'OBJ':
                    i = 0;
                    ret +=('{');
                    while(opcodes[i][0] != 'END') {
                        if(opcodes[i][0] == 'JSV') {
                            ret +=((i > 0 ? ',' : '') + opcodes[i][1]);
                        } else {
                            ret +=(this.translate([opcodes[i]]));
                        }
                        i++;
                    }
                    ret +=('}');
                    break;
                default:
                    ret +=(this.translate(opcodes));
                    break;
            }
            ret += !nested ? '\n' : '';
        }
        if(exprStack.length > 0) throw 'Unterminated expression!';
        if(nested) return ret;
        else this.write(ret);
    }

}

module.exports = class {
    vars = {} // Global variables
    expr = {} // Expressions
    part = {} // Partials
    constructor() {
        this.block('where', (block, print, context, n, obj) => {
            if(!obj || typeof obj != 'object') throw 'Invalid object passed to where function';
            if(obj._by) {                        
                n = n.sort((a, b) => {
                    if (a[obj._by] < b[obj._by])
                        return obj._order == 'desc' ? 1 : -1;
                    if (a[obj._by] > b[obj._by])
                        return obj._order == 'desc' ? - 1 : 1;
                    return 0;
                });
            }
            delete obj._by;
            delete obj._order; // don't need these anymore
            n.forEach((a) => {
                let unmatched = false;
                for(let i in obj) {
                    if(obj[i] != a[i]) {
                        unmatched = true;
                        break;
                    }
                }
                if(!unmatched) block(a);
            });
        });
    }
    set(k, v) { // Set a global
        this.vars[k] = v;
    }
    block(k, v) {
        this.expr[k] = v;
    }
    partial(k, v) {
        this.part[k] = this.transpile(v);
    }
    transpile(str) {
        let blocks = lexer(str);
        let render = [];
        let html = [];
        
        let tknList = {};
        let lpadNext = false, lpSet = false;
        for(let i in blocks) {
            if(blocks[i][0][0] == 'WSP') {
                blocks[i].shift();
                if(html.length > 0) html[html.length - 1] = html[html.length - 1].replace(/[\s]+$/g, '');
            }
            if(blocks[i][blocks[i].length - 1][0] == 'WSP') {
                blocks[i].pop();
                lpadNext = true;
                lpSet = true;
            }
            if(blocks[i][0][0] == 'HTML') { // HTML block, push as-is
                render.push({ opts: { html: 1 }, data: (html.push( lpadNext ? blocks[i][0][1].replace(/^[\s]+/g, '') : blocks[i][0][1] ) - 1)});
            } else if(blocks[i][0][0] == 'RAWHTML') {
                blocks[i].shift();
                render.push({ block: parse(str, blocks[i], 0, null, tknList), opts: {raw: 1} });
            } else {
                render.push({ block: parse(str, blocks[i], 0, null, tknList) });
            }
            if(!lpSet) lpadNext = false;
            else lpSet = false;
        }
        
        let _this = this; // been a while since I've done this
        const transpiler = new TranspileMachine();
        transpiler.transpile(render);
        let blocks_transpiled = transpiler.render();

        return (function(args) { // return a JS function which contains the transpiled code
            let localVars = { __vars: Object.assign({}, args) };
            let scope = []; // block expression locally scoped vars
            let buf = '';
            let getScope = (depth = 0) => {
                if(scope.length > 0) {
                    if(scope.length - depth < 0) throw "Scope non-existent";
                    return scope.length - depth == 0 ? localVars.__vars : scope[scope.length - depth - 1];
                }
                else return localVars.__vars;
            }
            localVars.__ev = (i, ...as) => { // resolve/eval using hashtable
                let scopeDepth = 0, g = 0;
                if(i[0] == '..') { // a scoped variable
                    while(i[g] == '..') {
                        scopeDepth++;
                        g++;
                    }
                }
                let curScope = getScope(scopeDepth); 
                if(curScope[i[g]] === undefined) curScope = _this.vars; // globals are always available
                let ptr = curScope;
                if(i.length > 1)  { // only validate object properties (otherwise empty variables just return 'undefined')
                    for(g = g; g < i.length; g++) {
                        if(g < i.length - 1 && ptr[i[g]] === undefined) {
                            // woops
                            throw 'Variable undefined! ' + i.join(',');
                        }
                        if(typeof ptr[i[g]] === 'function') {
                            if(g < i.length - 1) {
                                // only terminal functions are allowed, not obj.fn().obj, for simplicity's sake
                                // this could change in future but we don't want templating code looking messy
                                throw 'Functions only allowed at end of objects ' + i.join('.');
                            }
                            ptr = ptr[i[g]].bind(ptr); // make sure object property functions are binded properly
                                                                // (not sure the performance of this - could be shit, might want to use lambda instead)
                        } else 
                            ptr = ptr[i[g]]
                    }
                } else {
                    ptr = curScope[i];
                    if(typeof ptr === 'function') ptr = ptr.bind(curScope);
                }
                if(ptr !== undefined && typeof ptr === 'function') return ptr(...as);
                else {
                    if(as.length > 0) throw 'Variable ' + i + ' is not a function.';
                    return ptr;
                }
            }
            localVars.__print = (str) => {
                buf += typeof str == 'string' ? str.replace(/</g, '&lt;').replace(/>/g, '&gt;') : str;
            }
            localVars.__printRaw = (str) => {
                buf += str;
            } 
            localVars.__printHTML = (n) => {
                buf += html[n];
            }
            localVars.__each = (v, a, f) => {
                let old = null;
                let curScope = getScope();
                if(curScope[a] !== undefined) old = curScope[a];
                v.forEach((el) => {
                    curScope[a] = el;
                    f();
                });
                if(old !== null) curScope[a] = old;
                else delete curScope[a];
            }
            localVars.__with = (v, f) => {
                v.forEach((el) => {
                    scope.push(el);
                    f();
                    scope.pop();
                });
            }
            localVars.__expressions = _this.expr;
            localVars.__runExpr = (n, a, f) => {
                localVars.__expressions[n]((obj) => {
                    if(obj === undefined) f();
                    else {
                        scope.push(obj);
                        f();
                        scope.pop();
                    }
                 }, localVars.__print, getScope(), ...a);
                
            }
            localVars.__runPart = (n, a) => {
                // run a partial
                let curScope = getScope();
                let partial;
                let local = true;
                if(!curScope.__partials || !curScope.__partials[n]) {
                    partial = _this.part[n];
                    local = false;
                    if(!partial) throw 'Partial doesn\'t exist! ' + n;
                }
                else partial = curScope.__partials[n];
                if(typeof a === 'function') {
                    // block partial, this passes other partials to a partial
                    scope.push({});
                    a(); // this function likely registers some partials
                    if(local) partial();
                    else localVars.__printRaw(partial(getScope())); // run the partial in context
                    scope.pop(); // clean off the scope
                } else {
                    scope.push(a);
                    if(local) partial();
                    else localVars.__printRaw(partial(a));
                    scope.pop();
                }
            }
            localVars.__createPart = (n, f) => {
                let curScope = getScope();
                if(!curScope.__partials) curScope.__partials = {};
                curScope.__partials[n] = f;
            }
            new Function(`
                let __html = ${JSON.stringify(html)};
                ${blocks_transpiled}
            `).call(localVars);

            return buf.replace(/\n\s+\n/g,'\n');
        });

    }

}