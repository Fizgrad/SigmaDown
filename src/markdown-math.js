export function createMathExtensions(slot) {
  return [
    {
      name: 'math',
      level: 'block',
      start(source) {
        const dollar = source.indexOf('$$');
        const bracket = source.indexOf('\\[');
        return dollar < 0 ? bracket : bracket < 0 ? dollar : Math.min(dollar, bracket);
      },
      tokenizer(source) {
        const match = source.match(/^\$\$([\s\S]*?)\$\$/) || source.match(/^\\\[([\s\S]*?)\\\]/);
        if (match) return { type: 'math', raw: match[0], html: slot(match[1].trim(), true) };
      },
      renderer: token => token.html
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: source => source.match(/\\\(|\$(?!\$)/)?.index,
      tokenizer(source) {
        if (source.startsWith('\\(')) {
          const end = source.indexOf('\\)', 2);
          if (end >= 0) return { type: 'inlineMath', raw: source.slice(0, end + 2), html: slot(source.slice(2, end).trim(), false) };
        } else if (source[0] === '$' && source[1] !== '$') {
          for (let end = 1; end < source.length; end++) {
            // An escape consumes the next character, including another backslash.
            if (source[end] === '\\') { end++; continue; }
            if (source[end] === '$') return { type: 'inlineMath', raw: source.slice(0, end + 1), html: slot(source.slice(1, end).trim(), false) };
          }
        }
      },
      renderer: token => token.html
    }
  ];
}
