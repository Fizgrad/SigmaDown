// Map Marked's nested token text back to the original Markdown. A token is only
// mapped when its exact source can be located inside its parent, so unsupported
// transformed constructs do not jump to an unrelated occurrence.
export function annotateSourceTokens(tokens, source) {
  function annotateList(list, start, end) {
    let cursor = start;
    for (const token of list) {
      if (!token || typeof token.raw !== 'string' || !token.raw) continue;
      const offset = source.indexOf(token.raw, cursor);
      if (offset < 0 || offset + token.raw.length > end) {
        // Containers such as blockquotes can remove their `> ` prefixes before
        // lexing children. Search the bounded parent for their child tokens.
        const children = token.tokens || token.items;
        if (!Array.isArray(children)) break;
        const next = annotateList(children, cursor, end);
        if (next <= cursor) break;
        cursor = next;
        continue;
      }
      const limit = offset + token.raw.length;
      token.sourceStart = offset;
      token.sourceEnd = limit;
      cursor = limit;
      if (Array.isArray(token.tokens)) annotateList(token.tokens, offset, limit);
      if (Array.isArray(token.items)) annotateList(token.items, offset, limit);
      if (token.type === 'table') {
        // Table cell tokens have no `raw` field. Locate their inline tokens in
        // source order, bounded by the table token itself.
        let cellCursor = offset;
        for (const cell of [...token.header, ...token.rows.flat()]) {
          if (!Array.isArray(cell.tokens)) continue;
          const raw = cell.tokens.map(t => t.raw || '').join('');
          const pos = raw ? source.indexOf(raw, cellCursor) : -1;
          if (pos < 0 || pos + raw.length > limit) continue;
          annotateList(cell.tokens, pos, pos + raw.length);
          cellCursor = pos + raw.length;
        }
      }
    }
    return cursor;
  }
  annotateList(tokens, 0, source.length);
}

export function installSourceMapping(marked) {
  const base = new marked.Renderer();
  function attributes(token, contentOnly = false) {
    if (!Number.isInteger(token.sourceStart) || !Number.isInteger(token.sourceEnd)) return '';
    let start = token.sourceStart, end = token.sourceEnd;
    if (contentOnly) {
      if (!token.text) return '';
      const fence = token.type === 'code' ? /^(?: {0,3})(?:`{3,}|~{3,})[^\n]*\n/.exec(token.raw) : null;
      const backticks = token.type === 'codespan' ? /^`+/.exec(token.raw) : null;
      const index = token.raw.indexOf(token.text, fence?.[0].length ?? backticks?.[0].length ?? 0);
      if (index < 0) return '';
      start += index; end = start + token.text.length;
    }
    return ` data-source-start="${start}" data-source-end="${end}"`;
  }
  marked.use({ renderer: {
    text(token) {
      if (token.tokens || !attributes(token)) return false;
      return `<span${attributes(token)}>${base.text(token)}</span>`;
    },
    codespan(token) {
      const attr = attributes(token, true);
      if (!attr) return false;
      return base.codespan(token).replace('<code>', `<code${attr}>`);
    },
    code(token) {
      const attr = attributes(token, true);
      if (!attr || token.lang?.trim().split(/\s+/)[0] === 'mermaid') return false;
      return base.code(token).replace('<code', `<code${attr}`);
    }
  }});
}

export function installCompatibleStrong(marked) {
  marked.use({ extensions: [{
    name: 'compatibleStrong', level: 'inline',
    start(source) { return source.indexOf('**'); },
    tokenizer(source) {
      const match = /^\*\*((?:\\[^\n]|[^*\\\n])+?)\*\*/u.exec(source);
      if (!match || !match[1].trim()) return;
      const content = match[1].trim();
      // Marked follows CommonMark's delimiter rules, which can reject closing
      // punctuation followed by Chinese text. Accept that common CJK form,
      // as well as padded delimiters, while leaving nested stars to Marked.
      if (!(/^\s|\s$/u.test(match[1])) && !(/^[\p{P}\p{S}]|[\p{P}\p{S}]$/u.test(content))) return;
      return { type: 'compatibleStrong', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
    },
    renderer(token) { return `<strong>${this.parser.parseInline(token.tokens)}</strong>`; }
  }] });
}

// Map a caret offset in rendered text to its UTF-16 source offset. Returning
// null means the browser's visible text could not be safely aligned.
export function sourceOffsetForText(raw, visible, position, decodeEntity) {
  if (!Number.isInteger(position) || position < 0 || position > visible.length) return null;
  if (raw === visible) return position;
  const offsets = [];
  let input = 0, output = 0;
  while (input < raw.length && output < visible.length) {
    if (raw[input] === '\\' && raw[input + 1] === visible[output]) input++;
    if (raw[input] === '&') {
      const entity = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.exec(raw.slice(input));
      const decoded = entity ? decodeEntity(entity[0]) : '';
      if (decoded && visible.startsWith(decoded, output)) {
        for (let j = 0; j < decoded.length; j++) offsets[output + j] = input;
        output += decoded.length;
        input += entity[0].length;
        offsets[output] = input;
        continue;
      }
    }
    if (raw[input] !== visible[output]) return null;
    offsets[output] = input;
    input++; output++;
    offsets[output] = input;
  }
  if (output !== visible.length) return null;
  return offsets[position] ?? (position === 0 && !visible ? 0 : null);
}
