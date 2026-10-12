import type { ReactNode } from "react";

/** Small line icons for the desktop chat screen. Decorative: the buttons that use them carry their own labels. */
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const make = (children: ReactNode) => (props: { size?: number; className?: string }) => (
  <svg {...base} width={props.size ?? 24} height={props.size ?? 24} className={props.className}>{children}</svg>
);

export const PhoneIcon = make(<path d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 5.9 5.9l1.3-2 4 1.6V18a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z" />);
export const VideoIcon = make(<><rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="m15.5 11 5-3v8l-5-3Z" /></>);
export const ShieldIcon = make(<><path d="M12 3.2 5 6v5.4c0 4.2 2.8 7.4 7 9.4 4.2-2 7-5.2 7-9.4V6l-7-2.8Z" /><path d="m9 12 2.2 2.2L15.2 10" /></>);
export const LockIcon = make(<><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>);
/** A solid lock, for the encryption line under a chat's name. */
export const LockSolidIcon = (props: { size?: number; className?: string }) => (
  <svg {...base} width={props.size ?? 24} height={props.size ?? 24} className={props.className}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" stroke="none" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" strokeWidth="2" />
  </svg>
);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const SearchIcon = make(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const LaptopIcon = make(<><rect x="5" y="5.5" width="14" height="10" rx="1.8" /><path d="M2.5 19h19" /></>);
export const GearIcon = make(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></>);
export const DotsIcon = make(<><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>);
export const PaperclipIcon = make(<path d="m19.5 11.2-7 7a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.3 4.3l-7.3 7.3a1.4 1.4 0 0 1-2-2l6.4-6.4" />);
export const CameraIcon = make(<><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /><circle cx="12" cy="12.5" r="3.3" /></>);
export const ChevronDownIcon = make(<path d="m7 10 5 5 5-5" />);
export const MicIcon = make(<><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21" /></>);
export const SmileIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0M9.2 9.6h.01M14.8 9.6h.01" /></>);
export const SendPlaneIcon = make(<path d="M20.5 3.5 3.5 10.8l6.3 2.4 2.4 6.3ZM9.8 13.2l6.4-6.2" />);
export const UsersIcon = make(<><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14a4.6 4.6 0 0 1 5 4.6" /></>);
export const DoubleCheckIcon = make(<><path d="m3 12.5 4.2 4.2L15 8.5" /><path d="m11 15.5 1.2 1.2L20.5 8.5" /></>);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const ShieldSolidIcon = ShieldIcon;
export const SignOutIcon = make(<><path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" /><path d="M15 8l4 4-4 4M19 12H9" /></>);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);

/** The Linqa mark: a chat bubble with three dots. */
export function LinqaMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="lcMark" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C4DE8" /><stop offset="1" stopColor="#4A28B8" />
        </linearGradient>
      </defs>
      <path d="M12 5h24a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H24l-9.5 8v-8H12a8 8 0 0 1-8-8V13a8 8 0 0 1 8-8Z" fill="url(#lcMark)" />
      <circle cx="15" cy="20" r="2.6" fill="#fff" /><circle cx="24" cy="20" r="2.6" fill="#fff" /><circle cx="33" cy="20" r="2.6" fill="#fff" />
    </svg>
  );
}

export const ListIcon = make(<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.2 6.5h.1M4.2 12h.1M4.2 17.5h.1" />);
export const ArchiveIcon = make(<><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2" /><path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9M10 13h4" /></>);
export const StarIcon = make(<path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8Z" />);
export const UserPlusIcon = make(<><circle cx="9.5" cy="8.5" r="3.2" /><path d="M3.5 19a6 6 0 0 1 12 0M18 8v6M15 11h6" /></>);
export const BellIcon = make(<><path d="M6 17.5V11a6 6 0 0 1 12 0v6.5l1.5 1.5h-15Z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></>);
export const FolderIcon = make(<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.2H19A1.5 1.5 0 0 1 20.5 9.2V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17Z" />);

export const BellOffIcon = make(<><path d="M6 17.5V11a6 6 0 0 1 9.5-4.9M18 11v6.5l1.5 1.5h-15M10 21a2.2 2.2 0 0 0 4 0M4 4l16 16" /></>);
export const TimerIcon = make(<><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 1.5M9.5 3h5" /></>);
export const FlagIcon = make(<path d="M5 21V4M5 4.5h11l-1.8 3.5 1.8 3.5H5" />);
export const BanIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>);
export const TrashIcon = make(<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" />);
export const CheckSquareIcon = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.3 2.5 2.5 4.5-5" /></>);
export const LinkIcon = make(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />);
export const InfoIcon = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>);
export const GridIcon = make(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>);

export const ReplyIcon = make(<path d="M9.5 6 4 11.5 9.5 17M4.5 11.5H14a6 6 0 0 1 6 6V19" />);
export const ForwardIcon = make(<path d="M14.5 6 20 11.5 14.5 17M19.5 11.5H10a6 6 0 0 0-6 6V19" />);
export const CopyIcon = make(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>);
