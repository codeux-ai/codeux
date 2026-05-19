import { h, type FunctionComponent } from "preact";

export const JiraIcon: FunctionComponent<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 12l6 6 6-6" transform="translate(-2, 0) rotate(-90 10 12)" />
      <path d="M4 12l6 6 6-6" transform="translate(4, 0) rotate(-90 10 12)" />
    </svg>
  );
};
