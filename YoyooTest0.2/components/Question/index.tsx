import { PersistedMessageStatus } from "@/lib/chat-types";
import Image from "@/components/Image";
import Document from "./Document";

type QuestionProps = {
    content: any;
    image?: string;
    document?: string;
    time: string;
    status?: PersistedMessageStatus;
    statusLabel?: string;
    retryLabel?: string;
    onRetry?: () => void;
};

const Question = ({
    content,
    image,
    document,
    time,
    status,
    statusLabel,
    retryLabel,
    onRetry,
}: QuestionProps) => (
    <div className="max-w-[50rem] ml-auto">
        <div className="space-y-6 pt-6 px-6 pb-16 border-3 border-n-2 rounded-[1.25rem] md:p-5 md:pb-14 dark:border-transparent dark:bg-n-5/50">
            {document && <Document value={document} />}
            <div className="">{content}</div>
            {image && (
                <div className="relative w-[11.25rem] h-[11.25rem]">
                    <Image
                        className="rounded-xl object-cover"
                        src={image}
                        width={180}
                        height={180}
                        alt="Avatar"
                    />
                </div>
            )}
        </div>
        <div className="-mt-8 flex items-end pr-6">
            <div className="flex items-center gap-2 pb-0.5">
                <div className="caption1 text-n-4/50 dark:text-n-4">{time}</div>
                {!!status && status !== "sent" && (
                    <span
                        className={`px-2 py-0.5 rounded-md caption1 ${
                            status === "failed"
                                ? "text-accent-1 bg-accent-1/15"
                                : "text-primary-1 bg-primary-1/15"
                        }`}
                    >
                        {statusLabel}
                    </span>
                )}
                {status === "failed" && onRetry && (
                    <button
                        className="px-2 py-0.5 rounded-md caption1 text-accent-1 bg-accent-1/10 hover:bg-accent-1/20 transition-colors"
                        onClick={onRetry}
                    >
                        {retryLabel}
                    </button>
                )}
            </div>
            {/* <button className="ml-3 px-2 py-0.5 bg-n-3 rounded-md caption1 txt-n-6 transition-colors hover:text-primary-1 dark:bg-n-5/50">
                Edit
            </button> */}
            <div className="relative w-16 h-16 ml-auto rounded-2xl overflow-hidden shadow-[0_0_0_0.25rem_#FEFEFE] dark:shadow-[0_0_0_0.25rem_#232627]">
                <Image
                    className="object-cover"
                    src="/images/avatar.jpg"
                    width={64}
                    height={64}
                    alt="Avatar"
                />
            </div>
        </div>
    </div>
);

export default Question;
