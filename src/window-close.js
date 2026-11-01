// Tauri's close-request listener destroys the window automatically unless the
// event is prevented. Keep a single confirmation open for repeated requests.
export function createCloseHandler({ needsConfirmation, confirmDiscard, destroy, reportError }) {
  let confirming = false;
  return async event => {
    if (confirming) {
      event.preventDefault();
      return;
    }
    if (!needsConfirmation()) return;
    event.preventDefault();
    confirming = true;
    try {
      if (await confirmDiscard()) await destroy();
    } catch (error) {
      reportError(error);
    } finally {
      confirming = false;
    }
  };
}
