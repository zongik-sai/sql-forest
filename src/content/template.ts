import type { TemplateSlot } from './types';

/** {slotId} 자리에 선택값을 넣어 SQL을 만든다. 선택값은 콘텐츠가 정한 목록에서만 온다. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, id: string) => values[id] ?? '');
}

/** 모든 슬롯 선택 조합 (콘텐츠 검증용) */
export function slotCombinations(slots: TemplateSlot[]): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const s of slots) {
    combos = combos.flatMap((c) => s.options.map((o) => ({ ...c, [s.id]: o.value })));
  }
  return combos;
}

export function defaultSlotValues(slots: TemplateSlot[]): Record<string, string> {
  return Object.fromEntries(slots.map((s) => [s.id, s.options[0].value]));
}
