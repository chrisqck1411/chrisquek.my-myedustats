/* 404 page: show a different education quote on each visit. Every quote is already in the page;
   without this script only the fixed fallback quote shows. */

const LAST_KEY = 'mes-quote';

function read(): string | null {
  try {
    return sessionStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function write(value: string): void {
  try {
    sessionStorage.setItem(LAST_KEY, value);
  } catch {
    /* storage blocked: the quote is simply random each time */
  }
}

const all = Array.from(document.querySelectorAll<HTMLElement>('[data-quote]'));
if (all.length > 1) {
  const last = read();
  const choices = all.filter((el) => el.dataset.quote !== last);
  const pool = choices.length > 0 ? choices : all;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  for (const el of all) el.hidden = el !== pick;
  if (pick.dataset.quote) write(pick.dataset.quote);
}
