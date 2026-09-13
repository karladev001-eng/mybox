import { documentProjection, sameDocument } from "./document-edit.js";

/** One captured Page, one serial save stream. Reopening can reuse an unsaved session. */
export function createPaperSaveSession(page, save) {
  let target = page, base = structuredClone(page.blocks), draft = structuredClone(base), running = null, error = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  const session = {
    get base() { return base; }, get draft() { return draft; }, get error() { return error; },
    get dirty() { return !sameDocument(base, draft); }, get saving() { return Boolean(running); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    edit(blocks) { draft = structuredClone(blocks); error = null; notify(); },
    receive(nextPage) {
      if (running) return false;
      target = nextPage;
      if (session.dirty || sameDocument(base, nextPage.blocks)) return false;
      base = structuredClone(nextPage.blocks); draft = structuredClone(base); notify(); return true;
    },
    flush() {
      if (running) return running;
      if (!session.dirty) return Promise.resolve();
      running = Promise.resolve().then(async () => {
        while (session.dirty) {
          const snapshot = structuredClone(draft);
          const result = await save(target, { type: "document-edit", baseBlocks: documentProjection(base), documentBlocks: documentProjection(snapshot) });
          target = result.page;
          const caughtUp = sameDocument(draft, snapshot);
          // Newer typing was based on the submitted snapshot, not on remote
          // content included in its acknowledgement. Keep that base so the next
          // mutation cannot mistake an unseen remote edit for a local deletion.
          base = structuredClone(caughtUp ? result.page.blocks : snapshot);
          if (caughtUp) draft = structuredClone(base);
          error = null;
          notify();
        }
      }).catch(failure => { error = failure; }).finally(() => { running = null; notify(); });
      notify();
      return running;
    },
  };
  return session;
}
