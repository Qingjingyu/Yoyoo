import Member from "./Member";
import { useLocale } from "@/contexts/locale-context";

import { members } from "@/mocks/members";

type TeamProps = {};

const Team = ({}: TeamProps) => {
    const { t } = useLocale();

    return (
        <>
            <div className="flex items-center mb-8 md:mb-6">
                <div className="mr-auto h4">{t("settings.team.membersTitle")}</div>
                <button className="btn-blue">{t("settings.team.invite")}</button>
            </div>
            <div className="py-3 base2 text-n-4">{t("settings.team.membersCount")}</div>
            <div className="mb-6">
                {members.map((member, index) => (
                    <Member
                        item={member}
                        key={member.id}
                        style={{ zIndex: members.length - index }}
                    />
                ))}
            </div>
        </>
    );
};

export default Team;
