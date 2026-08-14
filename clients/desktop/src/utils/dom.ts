type Child = Node | string | null | undefined | false;

interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  onClick?: (e: MouseEvent) => void;
  onInput?: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) node.setAttribute(k, v);
  }
  if (options.style) Object.assign(node.style, options.style);
  if (options.onClick) node.addEventListener("click", options.onClick as EventListener);
  if (options.onInput) node.addEventListener("input", options.onInput);
  if (options.onKeyDown) node.addEventListener("keydown", options.onKeyDown as EventListener);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: Element) {
  node.replaceChildren();
}
