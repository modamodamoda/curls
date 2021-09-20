
/*
    Simple lexer for generating tokens.
    Currently doing it manually using indexOf and while loops,
    I wonder if regex is more efficient?
    After seeing some benchmarks, while loops can actually be slower in JS, 
    presumably because they don't compile to native-level efficiency

    ctokens contains a list of fixed tokens,
    then we have some tokens such as variable names, strings, etc,
    which are matched programmatically
*/

const ctokens = { // fixed tokens
    ELSEIF: ['#else if'],
    UNLESS: ['#unless'],
    ELSE: ['#else'],
    CREATEPART: ['#partial'],
    IF: ['#if'], // if
    ENDBLOCK: ['/each', '/if', '/with'], // end of blocks
    EACH: ['#each'], // each is special (:
    WITH: ['#with'], // with is special too
    LBR: ['('], // left bracket for nesting
    RBR: [')'], // right bracket for nesting
    OP: ['==','!=','<','>','>=','<='], // logical ops
    ANDOR: ['||','&&'], // and/or for conditional arguments
    MOP: ['%','+','-','/','*','&','|','^'], // mathematical and bitewise
    COMMA: [','], // comma for functional arguments
    BOOL: ['true', 'false'], // bools
    AS: ['as'], // as for each
    NOT: ['!'], // not
    EQ: ['='],
    WSP: ['~'] // determine whitespace
};

function isVarBegin(char) {
    return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_';
}

function isScopedVarBegin(str, i) {
    if(str.substr(i, 3) == '../') return true;
}

function isVarChar(char) { // matches alphanumeric, _
    return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_';
}

function isDigit(char) { // is a digit in a number
    return (char >= '0' && char <= '9') || char === '.';
}

function isDigitBegin(char) {
    return (char >= '0' && char <= '9');
}

function isBlockBegin(char) {
    return char == '#';
}

function isEndBlockBegin(char) {
    return char == '/';
}

function process_var(str, i, scope = false) {
    let parts = [];
    let cpart = i;
    let state = scope ? 0 : 1;
    while(str[i] && ((state == 0 && (str[i] === '.' || str[i] == '/')) || (state == 1 && (str[i] == '[' || str[i] == '.'|| isVarChar(str[i]))) || (state == 2 && (str[i] == ']' || isDigitBegin(str[i])) ))) { 
        if(state == 0) {
            while(str.substr(i, 3) == '../') {
                parts.push('..');
                i += 3;
                cpart += 3;
            }
            --i;
            state = 1;
        } else if(state == 1) {
            if(str[i] === '.' || str[i] == '[') {
                if(str[i - 1] == '.' || (scope && str[i - 1] == '/')) throw 'Invalid token from: ' + str.substr(i,5) + '..';
                if(cpart != i) parts.push(str.substr(cpart, i - cpart));
                cpart = i + 1;
                if(str[i] == '[' && isDigitBegin(str[i + 1])) state = 2;
                else if(str[i] == '[') {
                    // embedded var (should the lexer really be doing this or should the parser just have a more complex way of reading variables? hmm..
                    let ret = isScopedVarBegin(str, i + 1) ? process_var(str, i + 1, true) : process_var(str, i + 1);
                    // make sure it terminated at a ]
                    if(str[ret[0]] != ']') throw "Invalid end of variable!"+ str.substr(i,5) + '..';
                    parts.push(ret[1]);
                    if(str[i + 1] && (str[ret[0] + 1] == '.')) 
                    { 
                        cpart = ret[0] + 2;
                        i = ret[0] + 2;
                    } else { return [ret[0] + 1, parts]; }
                }
            }
        } else if(state == 2) {
            if(str[i] == ']') {
                parts.push(parseInt(str.substr(cpart, i - cpart)));
                if(str[i + 1] && str[i + 1] == '.') 
                { 
                    state = 1;
                    cpart = i + 2;
                    i+=2;
                } else return [i + 1, parts];
            }
        }
        i++;
    }
    if(i == cpart) throw 'Invalid token found';
    parts.push(str.substr(cpart, i - cpart));
    return [i, parts];
}

function process_blk(str, i) {
    let o = i;
    while(str[i] && isVarChar(str[i])) i++;
    return [i, str.substr(o, i - o)];
}

function isQuote(char) {
    return char === '"' || char === "'";
}

function process_number(str, i) {
    let o = i;
    while(str[i] && isDigit(str[i])) i++;
    return [i, str.substr(o, i - o)];
}

function process_string(str, i) {
    let o = i;
    i++;
    while(str[i] && (str[i] != str[o] || str[i - 1] === "\\")) {
        i++; // come back to this to properly implement character escapes
    }
    if(str.length == i)
        throw "Unterminated string!";
    return [i + 1, str.substr(o, i - o + 1)];
}

module.exports = function(str) {
    let i = 0;
    let t;
    let tokens = [];
    let blocks = [];
    let parsing = false; // state
    let rawhtml = false;
    while(i < str.length) {
        if(!parsing) {
            let t = i;
            while(true) {
                t = str.indexOf('{{', t);
                if(t === -1) {
                    // done
                    blocks.push([['HTML', str.substr(i)]]);
                    return blocks;
                } else {
                    if(str[t - 1] != '\\') {
                        // not escaped, we're parsing
                        parsing = true;
                        blocks.push([['HTML', str.substr(i, t - i)]]);
                        i = t + 2;
                        break;
                    } else { 
                        str = str.substr(0, t - 1) + str.substr(t);
                    }
                }
            }
        } else if(parsing) {
            // expressions that exist at the beginning and clash with fixed tokens
            if(tokens.length == 0 || (rawhtml && tokens.length == 1)) {
                if(isEndBlockBegin(str[i])) {
                    i++;
                    [i, t] = process_blk(str, i);
                    tokens.push(['ENDBLOCK', t, i]);
                    continue;
                } else if(str[i] == '>') {
                    tokens.push(['PARTIAL']);
                    i++;
                } 
            }
            // go through fixed tokens list
            let token;
            for(let t in ctokens) {
                for(let tx of ctokens[t]) {
                    if(str.substr(i, tx.length) == tx) { // hoping JS' substr performance here will be the same as a simple char* compare
                        token = [t, str.substr(i, tx.length), i];
                        i = i + tx.length;
                        break;
                    }
                }
                if(token) break;
            }
            if(!token) { // if no token, go through more abstract list of stuff and things
                if(str[i] == '{') {
                    // html entities
                    rawhtml = true;
                    tokens.push(['RAWHTML']);
                    i++;
                } else if(str[i] == '}' && str[i+1] == '}' && (!rawhtml || str[i+2] == '}')) {
                    parsing = false;
                    blocks.push(tokens);
                    tokens = [];
                    i = i + (rawhtml ? 3 : 2);
                    rawhtml = false;
                } else if(isVarBegin(str[i])) {
                    [i, t] = process_var(str, i);
                    tokens.push(['JSV', t, i]);
                } else if(isScopedVarBegin(str, i)) {
                    [i, t] = process_var(str, i, true);
                    tokens.push(['JSV', t, i]);
                } else if(isDigitBegin(str[i])) {
                    [i, t] = process_number(str, i);
                    tokens.push(['NUM', t, i]);
                } else if(isQuote(str[i])) {
                    [i, t] = process_string(str, i);
                    tokens.push(['STR', t, i]);
                } else if(str[i] == ' ' || str[i] == '\t') {
                    // whitespace, forget it
                    i++;  
                } else if(isBlockBegin(str[i])) {
                    i++;
                    if(str[i] == '>') {
                        tokens.push(['PARTIAL']); // for partial blocks
                        i++;
                    }
                    [i, t] = process_blk(str, i);
                    tokens.push(['BLOCK', t, i]);
                } else
                    throw 'Error, no token found at: ' + str.substr(i, 10) + '...';
            } else {
                tokens.push(token);
            }
        }
    }

    return blocks;
}
