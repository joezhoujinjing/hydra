export function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    // PowerShell-style: wrap in double quotes, escape internal double quotes
    return `"${value.replace(/"/g, '`"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function pwshQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
