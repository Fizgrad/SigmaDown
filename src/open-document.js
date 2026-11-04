// Confirm again if a document changed while a slow file read was in progress.
export async function openDocumentSafely({ load, getState, getText, isCurrent, confirmDiscard, show }) {
  const originalState = getState();
  const originalText = getText();
  const document = await load();
  if (!isCurrent() || getState() !== originalState) return 'stale';
  if (getText() !== originalText) {
    const confirmedText = getText();
    if (!await confirmDiscard()) return 'cancelled';
    if (!isCurrent() || getState() !== originalState) return 'stale';
    if (getText() !== confirmedText) return 'changed-again';
  }
  show(document);
  return 'opened';
}
