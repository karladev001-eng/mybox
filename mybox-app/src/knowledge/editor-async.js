/** Latest-request guard: obsolete successes and failures cannot replace a new selection. */
export function createLatestRequest() {
  let sequence = 0;
  return {
    invalidate() { sequence++; },
    begin() { const ticket = ++sequence; return () => ticket === sequence; },
  };
}

/** Preserve the edited Page identity and serialize revisions without waiting for list refreshes. */
export function createEditorWriteQueue({ update, onPending = () => {} }) {
  let tail = Promise.resolve();
  let pending = 0;
  const pages = new Map();
  return {
    get settled() { return tail; },
    enqueue(page, mutation, onSaved = () => {}) {
      const key = JSON.stringify([page.projectId, page.id]);
      const known = pages.get(key);
      if (!known || page.revision > known.revision) pages.set(key, structuredClone(page));
      const input = structuredClone(mutation);
      onPending(++pending);
      const result = tail.then(async () => {
        const target = pages.get(key);
        const saved = await update(target, input);
        pages.set(key, saved.page);
        onSaved(saved);
        return saved;
      });
      tail = result.catch(() => {}).finally(() => {
        if (--pending === 0) pages.clear();
        onPending(pending);
      });
      return result;
    },
  };
}
