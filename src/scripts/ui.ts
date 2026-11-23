/* Header behaviour: light/dark switch and role choice. Both are remembered on this device only. */

const THEME_KEY = 'mes-theme';
const ROLE_KEY = 'mes-role';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice simply lasts until the page is closed */
  }
}

/* Theme */
const root = document.documentElement;
const themeButton = document.getElementById('theme-toggle') as HTMLButtonElement | null;

function currentTheme(): 'light' | 'dark' {
  return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function syncThemeButton(): void {
  if (!themeButton) return;
  const dark = currentTheme() === 'dark';
  themeButton.setAttribute('aria-pressed', String(dark));
  const label = dark ? themeButton.dataset.labelLight : themeButton.dataset.labelDark;
  if (label) themeButton.setAttribute('aria-label', label);
}

themeButton?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  write(THEME_KEY, next);
  syncThemeButton();
});
syncThemeButton();

/* Mascot: one picture per role, swapped when the role changes. */
const mascot = document.getElementById('mascot') as HTMLImageElement | null;

function syncMascot(select: HTMLSelectElement): void {
  if (!mascot) return;
  const role = select.value;
  mascot.src = `/mascot/${role}.webp`;
  const base = mascot.dataset.alt ?? '';
  const label = select.options[select.selectedIndex]?.text ?? '';
  mascot.alt = role === 'default' ? base : `${base} (${label})`;
}

/* Role (remembered on this device; it changes the mascot, and more in a later slice) */
const roleSelect = document.getElementById('role') as HTMLSelectElement | null;
if (roleSelect) {
  const saved = read(ROLE_KEY);
  if (saved && Array.from(roleSelect.options).some((o) => o.value === saved)) {
    roleSelect.value = saved;
  }
  root.dataset.role = roleSelect.value;
  syncMascot(roleSelect);
  roleSelect.addEventListener('change', () => {
    write(ROLE_KEY, roleSelect.value);
    root.dataset.role = roleSelect.value;
    syncMascot(roleSelect);
  });
}
