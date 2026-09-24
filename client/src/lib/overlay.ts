/** Page scroll lock shared by sheets and dialogs; nested overlays keep the lock until the last closes. */
let locks = 0;

export function lockScroll(): () => void {
  locks++;
  document.documentElement.classList.add('scroll-locked');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks === 0) document.documentElement.classList.remove('scroll-locked');
  };
}
