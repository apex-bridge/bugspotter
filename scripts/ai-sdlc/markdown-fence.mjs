// CommonMark fenced code blocks, shared by the spec and ADR parsers: a fence
// opens with ``` or ~~~ (three or more) and closes with the same character,
// at least as long, followed only by spaces or tabs. After an opening backtick
// fence the info string cannot contain a backtick ("```code``` text" is prose).

// Returns step(line): true when the line is code (a fence line or inside a
// fence), so headings and bullets on it are content, not structure.
export function fenceTracker() {
  let fence = null;
  return (line) => {
    const f = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (f && !(fence === null && f[1][0] === '`' && f[2].includes('`'))) {
      if (!fence) {
        fence = f[1];
      } else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^[ \t]*$/.test(f[2])) {
        fence = null;
      }
      return true;
    }
    return fence !== null;
  };
}
