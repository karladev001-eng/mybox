export const IMAGE_STUDIO_SCHEMA_VERSION = 1;
export const TEMPLATE_CATEGORIES = Object.freeze(["world", "style", "composition", "mood"]);
export const MAX_REFERENCE_IMAGES = 4;
export const MAX_PROMPT_LENGTH = 16_000;

export const RATIOS = Object.freeze({
  auto: { ratio: null, unspecified: true },
  "1:1": { ratio: "1:1" },
  "4:5": { ratio: "4:5" },
  "3:4": { ratio: "3:4" },
  "3:2": { ratio: "3:2" },
  "16:9": { ratio: "16:9" },
  "21:9": { ratio: "21:9" },
  "9:16": { ratio: "9:16" },
});

const builtIns = {
  world: [
    ["none", "指定なし", ""],
    ["fantasy", "ファンタジー", "原景観から自然に発展した、叙情的で広大なファンタジー世界。風化した巨大構造と自然を静かに共存させ、破壊の瞬間ではなく長い時間、光、風、余白が感じられる幻想的な美しさを描く。"],
    ["sf", "SF", "数百年先まで使われてきたと感じられる、説得力のあるSF環境デザイン。機能とスケールが読める人工構造を地形や気候になじませ、過剰なメカや派手なVFXより素材の経年変化と静かな物語性を優先する。"],
    ["japanese", "和風", "日本建築の間、障子越しの光、木・石・紙・漆の素材感、季節の自然を活かした静かな世界。記号的な装飾を増やさず、非対称の余白と控えめな色彩で日本の美意識を表現する。"],
    ["cyberpunk", "都市／サイバーパンク", "積層する都市、雨に濡れた路面、配管や看板が作る高密度なサイバーパンク世界。暗部を潰さず都市の奥行きを保ち、ネオンは視線誘導のアクセントに限定して、巨大な建築スケールと生活の痕跡を描く。"],
    ["nature", "自然", "地形、水、樹木、雲を大きな面として捉えた広大な自然環境。前景・中景・遠景を空気の層で分け、必要なら非常に小さな人物を1人だけ置いて、人より大きな自然のスケール、風、光、静けさを強調する。"],
    ["neutral-studio", "ニュートラルスタジオ", "被写体の形・素材・色が正確に読める、落ち着いたニュートラルスタジオ。背景と床の境界を穏やかに処理し、柔らかな主光、控えめな補助光、自然な接地影で余計な装飾のない上質な空間にする。"],
  ],
  style: [
    ["none", "指定なし", ""],
    ["photo", "写実", "自然な光学特性、素材、肌理、被写界深度を備えた写実表現。過度なHDR、人工的なシャープネス、均一な細部を避け、焦点部だけを明瞭にして空気と奥行きを保つ。"],
    ["anime", "アニメ／セル", "読みやすい輪郭と整理された色面による上質なアニメ・セル画。陰影の段階を絞り、形とポーズを明快にしつつ、背景にも十分な空気遠近と光の一貫性を持たせる。"],
    ["flat", "フラットイラスト", "少数の色面、明快なシルエット、整理された形で構成するフラットイラスト。細部を均一に増やさず、大小のリズムと余白で視線を導き、小さな表示でも主題が一目で伝わるようにする。"],
    ["watercolor", "水彩", "遠目では写実的、近くでは筆触が見える水墨・水彩調のコンセプトアート。にじみ、乾いた筆、塗り残し、不均一な紙の質感を使い、焦点部だけを描き込み、遠景と周辺は大胆な色面と霧へ溶かす。"],
    ["oil", "油彩", "大きな平刷毛、重なる色面、削り取ったようなエッジを活かすペインタリーな油彩表現。光が当たる焦点部は精密に、周辺と遠景は大胆に省略し、写真の微細さより光・空気・量感を優先する。"],
    ["3d", "3D", "映画品質の3D表現。正確な形状、素材、接地、間接光を保ちながら、すべてを均一に磨いたデモ映像風にはせず、霧、被写界深度、表面の経年変化で自然な焦点と空気感を作る。"],
    ["pixel", "ピクセルアート", "意図的なピクセルクラスタと限定パレットによる高密度なピクセルアート。輪郭、明暗、奥行きの読みやすさを優先し、無作為なノイズや中途半端な高解像度表現を避ける。"],
  ],
  composition: [
    ["none", "指定なし", ""],
    ["poster", "ポスター", "1枚で完結する高級コンセプトアートポスター。大きな主景と非対称の余白で視線を導き、中心に要素を集めすぎない。文字を求められた場合だけ、2〜3語の短いタイトルと最小限の年・番号を細く控えめに配置し、ロゴや不要なコピーは入れない。"],
    ["social", "SNS投稿", "スクロール中にも主題が即座に伝わるSNS向け構図。重要要素を安全領域へ置き、端のトリミングや小さな表示でもシルエットと明暗の階層が崩れないようにする。文字は依頼された内容だけに限定する。"],
    ["product", "商品キービジュアル", "商品の輪郭、材質、機能が一目で伝わるキービジュアル。主役を明確に分離し、光と影で立体感を作り、背景・小物・反射は商品の魅力を補助する量に抑える。ブランド文字や仕様を勝手に追加しない。"],
    ["character", "人物／キャラクター", "人物のポーズ、シルエット、視線を主軸にした構図。顔だけへ寄りすぎず、衣装と周囲の空間から物語が読める距離を選び、背景の光と奥行きで人物を自然に分離する。不要な人物や身体部位を追加しない。"],
    ["background", "背景／情景", "暗く形の強い前景、主要情報のある中景、霧と光へ溶ける遠景・超遠景を重ねた環境構図。巨大な自然や建築と大胆な余白を主役にし、人物は必要ならスケールを示す小さな存在に留める。視線が集まる場所だけ精密に描く。"],
    ["icon", "アイコン", "単一の主題を中央の明快なシルエットへ整理したアイコン構図。小さく表示しても判別できる形、十分な余白、限られた色数とコントラストを使い、文字・細かな背景・装飾ノイズを避ける。"],
  ],
  mood: [
    ["none", "指定なし", ""],
    ["minimal", "ミニマル", "構図を決めた後に情報量をもう一段減らし、大きな面、明快なシルエット、静かな余白だけを残す。細部を均一に描かず、視線が集まる1か所だけを精密にして、少ない要素で空気と物語を伝える。"],
    ["editorial", "エディトリアル", "現代美術誌や建築展カタログのような抑制されたエディトリアル表現。整ったグリッド、広い余白、低彩度の色面を使い、文字を求められた場合だけ細い書体と広い字間で最小限に配置する。"],
    ["retro", "レトロ", "褪せた低彩度パレット、紙の粒子、控えめな版ずれを用いた上質なレトロ表現。古さを装飾の寄せ集めにせず、限られた色と印刷物らしい面の重なりで時代感を作る。"],
    ["neon", "ネオン", "暗い環境に少量のネオンを置き、反射、霧、縁光で発光を感じさせる。色数を絞り、発光部を画面の一部に限定して、派手なVFXや全面的な虹色より深い空間と視線誘導を優先する。"],
    ["cinematic", "シネマティック", "自然光を主役にした映画的な照明と空気感。雲間の光柱、霧を通る斜光、逆光、リムライト、淡い反射を使い、暗い前景から白く霞む遠景へ明確な空気遠近を作る。コントラストは強くても暗部の形は読めるようにする。"],
    ["cute", "かわいい", "丸みのある形、やわらかな光、明るく調和した少数色による親しみやすい雰囲気。幼く騒がしい装飾を増やさず、表情とシルエットを素直に見せ、余白のある上品なかわいさに整える。"],
    ["dark", "ダーク", "深いチャコール、青灰、黒緑を基調にした重い陰影。暗部を完全な黒へ潰さず、輪郭光、局所的な環境光、霧の階層で形と奥行きを残し、過剰なホラーや流血ではなく静かな緊張感を作る。"],
  ],
};

export const BUILT_IN_TEMPLATES = Object.freeze(Object.entries(builtIns).flatMap(([category, entries]) => entries.map(([key, name, prompt]) => Object.freeze({
  id: `builtin-${category}-${key}`, category, name, prompt, source: "built-in", revision: 2, state: "active",
}))));

export class ImageStudioError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "ImageStudioError"; this.code = code; this.details = details; }
}

function uid(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function nowIso(now) { return now().toISOString(); }

export function createImageStudioState() { return { schemaVersion: IMAGE_STUDIO_SCHEMA_VERSION, revision: 1, templates: [], generations: [] }; }

export function validateImageStudioState(state) {
  if (!state || state.schemaVersion !== IMAGE_STUDIO_SCHEMA_VERSION || !Array.isArray(state.templates) || !Array.isArray(state.generations)) {
    throw new ImageStudioError("INVALID_STATE", "Image App state is invalid");
  }
  return state;
}

export function parseTemplateMarkdown(markdown) {
  if (typeof markdown !== "string" || new TextEncoder().encode(markdown).byteLength > 256 * 1024) throw new ImageStudioError("INVALID_TEMPLATE", "Template must be UTF-8 Markdown up to 256 KiB");
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new ImageStudioError("INVALID_FRONT_MATTER", "Template requires YAML front matter");
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
    if (!pair) throw new ImageStudioError("INVALID_FRONT_MATTER", `Unsupported front matter line: ${line}`);
    metadata[pair[1]] = pair[2].replace(/^['"]|['"]$/g, "");
  }
  const prompt = match[2].trim();
  if (metadata.mybox !== "image-template/v1" || !metadata.name?.trim() || !TEMPLATE_CATEGORIES.includes(metadata.category) || !prompt) {
    throw new ImageStudioError("INVALID_TEMPLATE", "Template requires mybox, name, category, and a prompt body");
  }
  return { name: metadata.name.trim(), category: metadata.category, prompt };
}

export function serializeTemplateMarkdown({ name, category, prompt }) {
  if (!name?.trim() || !TEMPLATE_CATEGORIES.includes(category) || !prompt?.trim()) throw new ImageStudioError("INVALID_TEMPLATE", "Template fields are invalid");
  const safeName = name.trim().replace(/[\r\n]/g, " ").replace(/"/g, "\\\"");
  return `---\nmybox: image-template/v1\nname: "${safeName}"\ncategory: ${category}\n---\n${prompt.trim()}\n`;
}

export function addTemplate(state, template, { now = () => new Date(), idFactory = uid } = {}) {
  const copy = structuredClone(validateImageStudioState(state));
  const item = { id: idFactory("template"), ...template, source: "local", revision: 1, state: "active", createdAt: nowIso(now), updatedAt: nowIso(now) };
  copy.templates.unshift(item); copy.revision += 1; return { state: copy, template: item };
}

export function updateTemplate(state, id, changes, { now = () => new Date() } = {}) {
  const copy = structuredClone(validateImageStudioState(state)); const item = copy.templates.find((entry) => entry.id === id);
  if (!item) throw new ImageStudioError("TEMPLATE_NOT_FOUND", "Template was not found");
  Object.assign(item, changes, { revision: item.revision + 1, updatedAt: nowIso(now) }); copy.revision += 1; return { state: copy, template: item };
}

export function setTemplateState(state, id, nextState, options) { return updateTemplate(state, id, { state: nextState }, options); }

export function normalizeFinalPrompt(value) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw new ImageStudioError("PROMPT_REQUIRED", "全体Promptを入力してください");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new ImageStudioError("PROMPT_TOO_LONG", "全体Promptが長すぎます");
  return prompt;
}

export function compilePrompt({ subject, selections = {}, templates = [], ratio = "1:1", references = [], referenceInstruction = "", extra = "", promptOverride = null }) {
  if (!RATIOS[ratio]) throw new ImageStudioError("INVALID_RATIO", "出力比率が不正です");
  if (!Array.isArray(references) || references.length > MAX_REFERENCE_IMAGES) throw new ImageStudioError("TOO_MANY_REFERENCES", "参照画像は4枚までです");
  const target = RATIOS[ratio];
  if (promptOverride !== null && promptOverride !== undefined) return { prompt: normalizeFinalPrompt(promptOverride), target };
  const cleanSubject = subject?.trim(); if (!cleanSubject) throw new ImageStudioError("SUBJECT_REQUIRED", "主題を入力してください");
  const byId = new Map([...BUILT_IN_TEMPLATES, ...templates].map((item) => [item.id, item]));
  const parts = [`主題: ${cleanSubject}`];
  for (const [category, label] of [["world", "世界観"], ["style", "画風"], ["composition", "用途・構図"], ["mood", "雰囲気・装飾"]]) {
    const chosen = selections[category] ? byId.get(selections[category]) : null;
    if (chosen?.prompt) parts.push(`${label}: ${chosen.prompt}`);
  }
  if (!target.unspecified) parts.push(`出力: 縦横比 ${ratio}`);
  if (references.length) parts.push(`参照画像: ${referenceInstruction.trim() || "参照画像をコラージュせず、主参照の構図と空間構造を基準にする。被写体の位置・大きさ・奥行き・シルエット・光の方向・視線誘導・遠近関係を不用意に変えず、選択した世界観と画風で画像全体を再解釈する"}`);
  if (extra?.trim()) parts.push(`追加入力: ${extra.trim()}`);
  const prompt = parts.join("\n");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new ImageStudioError("PROMPT_TOO_LONG", "最終Promptが長すぎます");
  return { prompt, target };
}

export function createPendingGeneration(state, input, compiled, { now = () => new Date(), idFactory = uid } = {}) {
  const copy = structuredClone(validateImageStudioState(state));
  const generation = { id: idFactory("generation"), state: "generating", createdAt: nowIso(now), updatedAt: nowIso(now), input: structuredClone(input), finalPrompt: compiled.prompt, target: compiled.target, resource: null, actual: null, warning: null, error: null };
  copy.generations.unshift(generation); copy.revision += 1; return { state: copy, generation };
}

export function finishGeneration(state, id, result, { now = () => new Date() } = {}) {
  const copy = structuredClone(validateImageStudioState(state)); const generation = copy.generations.find((item) => item.id === id);
  if (!generation) throw new ImageStudioError("GENERATION_NOT_FOUND", "Generation was not found");
  Object.assign(generation, result, { state: "complete", updatedAt: nowIso(now), error: null });
  const actualRatio = result.actual?.width / result.actual?.height;
  const [ratioWidth, ratioHeight] = generation.target?.ratio?.split(":").map(Number) ?? [];
  const targetRatio = ratioWidth && ratioHeight ? ratioWidth / ratioHeight : generation.target?.width / generation.target?.height;
  if (!generation.target?.unspecified && actualRatio && targetRatio && Math.abs(actualRatio / targetRatio - 1) > 0.01) generation.warning = "選択した比率と生成画像の実寸が1%を超えて異なります";
  copy.revision += 1; return { state: copy, generation };
}

export function failGeneration(state, id, error, { now = () => new Date() } = {}) {
  const copy = structuredClone(validateImageStudioState(state)); const generation = copy.generations.find((item) => item.id === id);
  if (!generation) throw new ImageStudioError("GENERATION_NOT_FOUND", "Generation was not found");
  Object.assign(generation, { state: "error", updatedAt: nowIso(now), error: { code: error.code ?? "GENERATION_FAILED", message: error.message } }); copy.revision += 1; return { state: copy, generation };
}

export function setGenerationState(state, id, nextState) {
  const copy = structuredClone(validateImageStudioState(state)); const generation = copy.generations.find((item) => item.id === id);
  if (!generation) throw new ImageStudioError("GENERATION_NOT_FOUND", "Generation was not found"); generation.state = nextState; copy.revision += 1; return { state: copy, generation };
}

export function purgeGeneration(state, id) { const copy = structuredClone(validateImageStudioState(state)); const before = copy.generations.length; copy.generations = copy.generations.filter((item) => item.id !== id); if (copy.generations.length === before) throw new ImageStudioError("GENERATION_NOT_FOUND", "Generation was not found"); copy.revision += 1; return { state: copy, id }; }
