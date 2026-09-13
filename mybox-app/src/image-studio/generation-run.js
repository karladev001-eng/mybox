export const GENERATION_COUNTS = [1, 2, 3, 4];

/** Sequence existing authorized Operations. Never retry an uncertain attempt. */
export async function runImageGenerations({ count, input, generate, stopped = () => false, onProgress = () => {}, onResult = async () => {} }) {
  if (!GENERATION_COUNTS.includes(count)) throw new Error("生成枚数は1〜4枚で指定してください");
  const snapshot = structuredClone(input);
  const generations = [];
  for (let index = 0; index < count; index++) {
    if (stopped()) break;
    onProgress({ current: index + 1, total: count });
    const { generation } = await generate(structuredClone(snapshot));
    generations.push(generation);
    await onResult(generation);
    if (generation.state !== "complete") return { generations, failed: generation, stopped: false };
  }
  return { generations, failed: null, stopped: generations.length < count };
}
