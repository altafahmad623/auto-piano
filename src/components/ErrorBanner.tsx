interface Props {
  message: string;
}

/** Inline error panel using existing design tokens — replaces alert(). */
export function ErrorBanner({ message }: Props) {
  return <div className="error-banner">{message}</div>;
}
