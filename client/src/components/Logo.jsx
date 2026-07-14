import logoUrl from '../assets/logo.svg';

// The one place the logo asset is referenced. Swap client/src/assets/logo.svg
// to rebrand everywhere this renders (Landing, Knock header).
export function Logo({ size = 24, className }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt=""
      draggable="false"
      className={className}
    />
  );
}
