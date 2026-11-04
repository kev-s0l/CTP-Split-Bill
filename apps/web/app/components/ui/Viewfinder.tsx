import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { IconButton } from "./Button";

type ViewfinderProps = {
  detected?: boolean;
  hint?: string;
  children?: ReactNode;
  onCancel?: () => void;
  onFlash?: () => void;
  onUpload?: () => void;
  onCapture?: () => void;
};

// Camera capture chrome. Dark in both themes; `children` is the live preview.
export function Viewfinder({ detected, hint = "Fit the whole receipt inside the frame", children, onCancel, onFlash, onUpload, onCapture }: ViewfinderProps) {
  return (
    <div className="sb-vf">
      <div className="sb-vf__top">
        <IconButton icon="close" label="Cancel" tone="camera" onClick={onCancel} />
        <IconButton icon="flash" label="Flash" tone="camera" onClick={onFlash} />
      </div>
      <div className={cx("sb-vf__frame", detected && "is-detected")}>
        {children}
        <i className="sb-vf__corner tl" />
        <i className="sb-vf__corner tr" />
        <i className="sb-vf__corner bl" />
        <i className="sb-vf__corner br" />
      </div>
      <p className="sb-vf__hint">{hint}</p>
      <div className="sb-vf__controls">
        <button type="button" className="sb-vf__upload" onClick={onUpload}>
          <Icon name="image" size={22} />
          <span>Upload</span>
        </button>
        <button type="button" className="sb-vf__shutter" aria-label="Take photo" onClick={onCapture}>
          <span />
        </button>
        <span aria-hidden />
      </div>
    </div>
  );
}
