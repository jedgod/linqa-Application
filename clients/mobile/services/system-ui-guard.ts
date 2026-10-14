// Lets a screen open something that belongs to the phone (photo picker, file picker, camera, contacts, a permission
// prompt) without being treated as "the app went to the background".
//
// A chat wipes its decrypted attachments and closes its attachment sheets whenever the app leaves the foreground, which
// is the right thing when someone switches apps. But the phone's own pickers also take focus for a moment, and that
// wiped the half-finished attachment the person was in the middle of choosing. Wrap the call that opens the picker in
// withSystemUi; the chat ignores the focus change while it runs and for a moment afterwards.

let open = 0;

const GRACE_MS = 1500;

export async function withSystemUi<T>(run: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await run();
  } finally {
    // The "app is active again" event can arrive just after the picker's promise settles.
    setTimeout(() => { open = Math.max(0, open - 1); }, GRACE_MS);
  }
}

/** True while the app itself has a system picker or prompt open. */
export const systemUiOpen = () => open > 0;
