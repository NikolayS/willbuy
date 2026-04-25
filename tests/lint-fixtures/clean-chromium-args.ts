// Positive lint fixture: this file MUST pass lint cleanly. It exists to
// prove the rule allows legitimate Chromium argument arrays as long as
// they don't include the banned '--no-sandbox' flag.

export const chromiumArgs: string[] = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
];
