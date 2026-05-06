export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function pwshQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
