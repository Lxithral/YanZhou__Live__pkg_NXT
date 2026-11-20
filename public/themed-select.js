export function initThemedSelects() {
  if (!CSS.supports('appearance', 'base-select')) return;
  for (const select of document.querySelectorAll('select:not([multiple])')) {
    let trigger = select.querySelector(':scope > button');
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.append(document.createElement('selectedcontent'));
      select.prepend(trigger);
    }
    trigger.classList.add('select-display');
  }
}
