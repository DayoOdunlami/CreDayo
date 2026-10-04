const nf = new Intl.NumberFormat('en-GB');

export const fmtInt = (n: number) => nf.format(Math.round(n));

export function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return fmtInt(n);
}

export function fmtMoney(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `£${Math.round(n / 1000)}k`;
  return `£${Math.round(n)}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
