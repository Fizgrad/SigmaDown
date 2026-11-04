import GithubSlugger from 'github-slugger';

export function detectLineEnding(text) {
  return text.includes('\r\n') && !text.replace(/\r\n/g, '').includes('\n') ? '\r\n' : '\n';
}

export function serializeText(text, lineEnding) {
  return lineEnding === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

export function createHeadingIds(headings) {
  const slugger = new GithubSlugger();
  return headings.map(text => slugger.slug(text) || slugger.slug('section'));
}
