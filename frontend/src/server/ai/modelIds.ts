/** Model ids, shared by the worker and the page (kept apart so the page bundle doesn't pull in the ML runtime). */
export const MODELS = {
  embeddings: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  speech: "onnx-community/whisper-base",
  writer: "onnx-community/Qwen2.5-0.5B-Instruct",
} as const;
