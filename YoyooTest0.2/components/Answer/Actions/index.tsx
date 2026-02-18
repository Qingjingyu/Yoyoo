import { useState } from "react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { toast } from "react-hot-toast";
import Image from "@/components/Image";
import Notify from "@/components/Notify";
import ModalShareChat from "@/components/ModalShareChat";
import { useLocale } from "@/contexts/locale-context";

type ActionsProps = {};

const Actions = ({}: ActionsProps) => {
    const [copied, setCopied] = useState<boolean>(false);
    const [share, setShare] = useState<boolean>(false);
    const [archive, setArchive] = useState<boolean>(false);
    const [visibleModal, setVisibleModal] = useState<boolean>(false);
    const { t } = useLocale();

    const onCopy = () => {
        setCopied(true);
        toast(() => (
            <Notify iconCheck>
                <div className="ml-3 h6">
                    {t("answerActions.contentCopied")}
                </div>
            </Notify>
        ));
    };

    const handleClick = () => {
        toast((toastItem) => (
            <Notify iconCheck>
                <div className="mr-6 ml-3 h6">
                    {t("answerActions.chatArchived")}
                </div>
                <button
                    className="btn-blue btn-medium ml-3"
                    onClick={() => toast.dismiss(toastItem.id)}
                >
                    {t("answerActions.undo")}
                </button>
            </Notify>
        ));
    };

    const styleButton: string =
        "h-6 ml-3 px-2 bg-n-3 rounded-md caption1 txt-n-6 transition-colors hover:text-primary-1 dark:bg-n-7";

    return (
        <>
            <CopyToClipboard text={t("answerActions.copySource")} onCopy={onCopy}>
                <button className={`${styleButton} md:hidden`}>
                    {t("answerActions.copy")}
                </button>
            </CopyToClipboard>
            <button className={styleButton}>
                {t("answerActions.regenerate")}
            </button>
            {!share && !archive && (
                <div className="flex ml-3 px-1 space-x-1 bg-n-3 rounded-md md:hidden dark:bg-n-7">
                    <button className="" onClick={() => setShare(true)}>
                        <Image
                            src="/images/smile-heart-eyes.png"
                            width={24}
                            height={24}
                            alt={t("answerActions.altSmileHeartEyes")}
                        />
                    </button>
                    <button className="" onClick={() => setArchive(true)}>
                        <Image
                            src="/images/smile-unamused.png"
                            width={24}
                            height={24}
                            alt={t("answerActions.altSmileUnamused")}
                        />
                    </button>
                </div>
            )}
            {share && (
                <button
                    className={`flex items-center ${styleButton} pl-1 md:hidden`}
                    onClick={() => setVisibleModal(true)}
                >
                    <Image
                        src="/images/smile-heart-eyes.png"
                        width={24}
                        height={24}
                        alt={t("answerActions.altSmileHeartEyes")}
                    />
                    {t("answerActions.share")}
                </button>
            )}
            {archive && (
                <button
                    className={`flex items-center ${styleButton} pl-1 md:hidden`}
                    onClick={handleClick}
                >
                    <Image
                        src="/images/smile-unamused.png"
                        width={24}
                        height={24}
                        alt={t("answerActions.altSmileUnamused")}
                    />
                    {t("answerActions.archiveChat")}
                </button>
            )}
            <ModalShareChat
                visible={visibleModal}
                onClose={() => setVisibleModal(false)}
            />
        </>
    );
};

export default Actions;
