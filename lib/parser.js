
/* Grammar definition here is very simple:
    The parser has 3 possible 'states': 'ARG', 'NEST' and null,
    null state is ran on a root expression,
    blocks contain arguments and also 'nested expressions',
    arguments run through the 'ARG' state
    and nested expressions run through the 'NEST' state
*/
const grammars = {
    'default': [ 
        { name: 'EXPR', 
          grammar: ['EXPR', '?END', '$ARG', 1] },
        { name: 'EXPRPART', 
          grammar: ['PARTIAL', 'EXPR', '?END', '$ARG', 1] },
        { name: 'IF', 
          grammar: ['IF', '$ARG', ['ANDOR','END'], 1] },
        { name: 'UNLESS', 
          grammar: ['UNLESS', '$ARG', ['ANDOR','END'], 1] },
        { name: 'ELSE',
          grammar: ['ELSE', 'END'] },
        { name: 'ELIF',
          grammar: ['ELSEIF', '$ARG', ['ANDOR', 'END'], 1]},
        { name: 'FUNC', 
          grammar: ['JSV', '$ARG', '?END', 1] },
        { name: 'EACH', 
          grammar: ['EACH', '$ARG', ['AS','END'], 'JSV', 'END'] },
        { name: 'WITH',
          grammar: ['WITH', '$ARG', 'END']},
        { name: 'VAR', 
          grammar: ['$ARG',['OP', 'MOP', 'END'],0] },
        { name: 'EXPRVAR',
          grammar: ['$ARG', ['ANDOR','END'], 0] },
        { name: 'ENDEXPR',
          grammar: ['ENDEXPR','END'] },
        { name: 'PARTIAL',
          grammar:['PARTIAL', 'JSV', ['$ARG','END'], 'END'] },
        { name: 'CREATEPART',
          grammar: ['CREATEPART', 'JSV', 'END']}
    ],
    'ARG': [{
        name: 'ARG',
        grammar: ['?NOT', ['STR', 'NUM', 'JSV', 'BOOL', { start: 'LBR', state: '$NEST', end: 'RBR' }]]
    }],
    'NEST': [
        { name: 'FUNC', 
          grammar: ['JSV', '$ARG', '?END', 1] },
        { name: 'EXPRVAR',
          grammar: ['$ARG', ['ANDOR','END'], 0] },
        { name: 'VAR', 
          grammar: ['$ARG',['OP', 'MOP', 'END'],0]},
        { name: 'OBJ',
          grammar: ['JSV', 'EQ', '$ARG', '?END', 0]} ]
}

function parse(orig, block, start = 0, end = null, tknList = {}, state = false) {
    // validates and transpiles (kind of a parser)
    if(block[block.length - 1][0] != 'END') block.push(['END']); // pad right with END token
    const getTkn = (v) => {
        let t = '';
        for(let i = 0; i < v.length; i++) {
            if(i > 0) t+= (v[i-1] == '..' ? '/' : '.');
            t += v[i];
        }
        tknList[t] = v;
        return t;
    }
    let available_grammars = [];
    for(let i of grammars[state || 'default']) {
        available_grammars.push(Object.assign({gPos: 0, bPos: start, jstokens: []}, i));
    }
    let result;

    while(available_grammars.length > 0) {

        let idx = 0;
        while(idx < available_grammars.length) {
            let grammar = available_grammars[idx];
            let pos = grammar.bPos;

            if(grammar.grammar.length == grammar.gPos) { // for grammars without a defined END
                if(!result || grammar.jstokens.length > result.jstokens.length) result = grammar; // longest result wins
                available_grammars.splice(idx);
                continue;
            }
            let tok = block[pos][0];       
            let argPos = -1, argRes, argGr;

            // If in end, token should be treated as end
            if(end && end.includes(tok)) tok = 'END';
            else if(end && tok == 'END') throw 'Unexpected end of block!'; // unless END is specified in the end variable, don't accept an END

            // match current grammars with token
            if(Number.isInteger(grammar.grammar[grammar.gPos])) 
                grammar.gPos = grammar.grammar[grammar.gPos]; // looped back

            // Check for next grammar rule
            for(let rule of Array.isArray(grammar.grammar[grammar.gPos]) ? grammar.grammar[grammar.gPos] : [grammar.grammar[grammar.gPos]]) {
                if(typeof rule === 'object') {
                    if(tok == rule.start) {
                        [argPos, argRes, argGr] = parse(orig, block, pos + 1, [rule.end], tknList, rule.state.substr(1));
                        if(argPos != -1) {
                            tok = rule.state.substr(1);
                            argPos++; // skip over last element
                            break;
                        }
                    }
                } else if (rule[0] == '$') {
                    [argPos, argRes, argGr] = parse(orig, block, pos, null, tknList, rule.substr(1));
                    if(argPos != -1) {
                        tok = rule.substr(1);
                        break;
                    }
                } else if(rule[0] == '?') {
                    if(tok != rule.substr(1)) {
                        grammar.gPos++;
                        idx++;
                        continue;
                    } else {
                        argPos = 0;
                        break;
                    }
                } else if(rule == tok) {
                    argPos = 0;
                    break;
                }
            }
            
            // Check for match
            if(argPos != -1) {
                grammar.gPos++;
            } else {
                available_grammars.splice(idx, 1);
                
                if(available_grammars.length == 0 && !result) { // no matched grammars - token unexpected
                    if(state != 'ARG') { 
                        console.log(block[pos]);
                        throw 'Unexpected token near ' + orig.substr(block[pos][2], 10) + '!';
                    }
                    else return [-1]; // in an ARG, return -1
                }

                continue;
            }
            // add js-tokens for transpiling
            if(tok == 'END') {
                if(state != 'ARG') grammar.jstokens.push(['END']);
                if(!result || grammar.jstokens.length > result.jstokens.length) result = grammar; // longest result wins
                available_grammars.splice(idx);
                continue;
            } 
            else if(tok == 'STR' || tok == 'NUM' || tok == 'OP' || tok == 'MOP' || tok == 'ANDOR' || tok == 'BOOL') {
                grammar.jstokens.push(['DIR', block[pos][1]]);
                grammar.bPos++;
            }
            else if(tok == 'JSV') {
                grammar.jstokens.push(['JSV', block[pos][1]]);
                grammar.bPos++;
            }
            else if(tok == 'ARG') {
                grammar.jstokens.push(['ARG', argRes]);
                grammar.bPos = argPos;
            }
            else if(tok == 'ENDEXPR' || tok == 'EXPR') {
                grammar.jstokens.push(['LKP', block[pos][1]]);
                grammar.bPos++;
            }
            else if(tok == 'NEST') {
                grammar.jstokens.push(['NEST', argRes, argGr]);
                grammar.bPos = argPos;
            }
            else if(tok == 'PARTIAL' || tok == 'CREATEPART' || tok == 'COMMA' || tok == 'AS' || tok == 'EACH' || tok == 'WITH' || tok == 'IF' || tok == 'ELSE' || tok == 'ELSEIF' || tok == 'UNLESS') {
                grammar.bPos++; // these are just for semantic checking, and the transpiler will just add these between args automatically
            } 
            else if(tok == 'NOT') {
                grammar.jstokens.push(['DIR', '!']);
                grammar.bPos++;
            }
            else if(tok == 'EQ') {
                grammar.jstokens.push(['EQ']);
                grammar.bPos++;
            }
            else {
                throw 'Unexpected Token!';
            }
            idx++;
        }

    }
    return [result.bPos, result.jstokens, result.name];
}

module.exports = parse;