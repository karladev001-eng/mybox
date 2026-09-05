export function pageHeadings(blocks = []) {
  return blocks.filter((block) => /^heading-[123]$/.test(block.type)).map((block) => ({
    id: block.id, level: Number(block.type.slice(-1)), title: block.text?.trim() || "無題の見出し",
  }));
}
