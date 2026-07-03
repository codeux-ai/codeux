export interface AccessibilityFinding {
  element: HTMLElement;
  reason: string;
}

const NAME_ATTRIBUTE_SELECTORS = [
  "aria-label",
  "aria-labelledby",
  "title",
] as const;

const HORIZONTAL_OVERFLOW_CLASSES = [
  "w-screen",
  "min-w-screen",
  "w-[100vw]",
  "min-w-[100vw]",
  "w-[200vw]",
  "min-w-[200vw]",
] as const;

const SCROLL_BOUNDARY_CLASSES = [
  "overflow-x-auto",
  "overflow-auto",
  "overflow-x-scroll",
  "overflow-scroll",
  "overflow-hidden",
] as const;

function hasAccessibleNameAttribute(element: HTMLElement): boolean {
  return NAME_ATTRIBUTE_SELECTORS.some((attribute) => {
    const value = element.getAttribute(attribute);
    return value !== null && value.trim().length > 0;
  });
}

function hasVisibleText(element: HTMLElement): boolean {
  return (element.textContent ?? "").trim().length > 0;
}

export function collectIconOnlyButtonsWithoutNames(root: ParentNode): AccessibilityFinding[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => !hasVisibleText(button) && !hasAccessibleNameAttribute(button))
    .map((button) => ({ element: button, reason: "Icon-only button is missing an accessible name" }));
}

export function getLiveRegionRole(element: HTMLElement): "status" | "alert" | "log" | null {
  const role = element.getAttribute("role");
  return role === "status" || role === "alert" || role === "log" ? role : null;
}

export function expectLiveRegion(
  element: HTMLElement,
  expected: { role: "status" | "alert" | "log"; live?: "polite" | "assertive" | "off" },
): void {
  const role = getLiveRegionRole(element);
  if (role !== expected.role) {
    throw new Error(`Expected live region role ${expected.role}, received ${role ?? "none"}`);
  }

  if (expected.live !== undefined && element.getAttribute("aria-live") !== expected.live) {
    throw new Error(`Expected aria-live ${expected.live}, received ${element.getAttribute("aria-live") ?? "none"}`);
  }
}

function classListContainsAny(element: HTMLElement, classNames: readonly string[]): boolean {
  return classNames.some((className) => element.classList.contains(className));
}

function hasContainingScrollBoundary(element: HTMLElement): boolean {
  let current = element.parentElement;
  while (current) {
    if (classListContainsAny(current, SCROLL_BOUNDARY_CLASSES)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function collectHorizontalOverflowWithoutBoundary(root: ParentNode): AccessibilityFinding[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[class]"))
    .filter((element) => classListContainsAny(element, HORIZONTAL_OVERFLOW_CLASSES))
    .filter((element) => !hasContainingScrollBoundary(element))
    .map((element) => ({ element, reason: "Viewport-width overflow class is missing a containing scroll or clip boundary" }));
}
