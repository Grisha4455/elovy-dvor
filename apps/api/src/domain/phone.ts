/**
 * Приводит белорусский номер к виду +375XXXXXXXXX.
 * Принимает «+375 (29) 123-45-67», «80291234567», «375291234567».
 * Возвращает null, если номер не похож на белорусский мобильный или городской.
 */
export function normalizeBelarusPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()\-.]/g, "");
  let national: string | undefined;
  if (/^\+375\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^375\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^80\d{9}$/.test(digits)) national = digits.slice(2);
  if (!national) return null;
  // Мобильные операторы 25/29/33/44 и городские коды областей (15, 16, 17, 21, 22, 23)
  if (!/^(25|29|33|44|15|16|17|21|22|23)\d{7}$/.test(national)) return null;
  return `+375${national}`;
}

export function formatBelarusPhone(phone: string): string {
  const n = phone.slice(4);
  return `+375 (${n.slice(0, 2)}) ${n.slice(2, 5)}-${n.slice(5, 7)}-${n.slice(7)}`;
}
