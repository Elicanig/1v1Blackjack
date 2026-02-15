const SUIT_PATHS = {
  H: `
    <path d="M12 21.3c-.28 0-.55-.1-.76-.28C8.89 18.97 4 15.2 4 10.33 4 7.37 6.34 5 9.21 5c1.13 0 2.24.48 3.08 1.31A4.2 4.2 0 0 1 15.38 5C18.45 5 21 7.45 21 10.43c0 4.77-4.86 8.52-7.2 10.58a1.1 1.1 0 0 1-.8.3z"/>
  `,
  D: `
    <path d="M12 2.4 20.2 12 12 21.6 3.8 12z"/>
  `,
  C: `
    <circle cx="12" cy="7.1" r="3.55"/>
    <circle cx="7.7" cy="12.1" r="3.55"/>
    <circle cx="16.3" cy="12.1" r="3.55"/>
    <path d="M11.22 14.55h1.56v5.15H15V22H9v-2.3h2.22z"/>
  `,
  S: `
    <path d="M12 2.35c-.28 0-.55.1-.75.31-2.95 3.1-6.72 6.02-6.72 9.88 0 2.47 1.89 4.48 4.21 4.48 1.27 0 2.42-.61 3.26-1.6V22H9.9v2.35h6.2V22H14v-6.58c.84.99 2 1.6 3.26 1.6 2.32 0 4.21-2.01 4.21-4.48 0-3.86-3.77-6.78-6.72-9.88a1.06 1.06 0 0 0-.75-.31z"/>
  `
};

export function renderSuitIconSvg(suit, className = '') {
  const iconClass = className ? `suit-icon ${className}` : 'suit-icon';
  const key = SUIT_PATHS[suit] ? suit : 'S';
  return `
    <svg class="${iconClass}" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      ${SUIT_PATHS[key]}
    </svg>
  `;
}
