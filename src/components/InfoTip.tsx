interface Props {
  tip: string;
}

/** (i) marker with a hover tooltip; pure CSS, no dependencies. */
export function InfoTip({ tip }: Props) {
  return (
    <span className="info-tip" tabIndex={0}>
      ⓘ
      <span className="info-tip-text" role="tooltip">{tip}</span>
    </span>
  );
}
