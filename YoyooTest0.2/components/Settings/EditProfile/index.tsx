import { useState } from "react";
import Image from "@/components/Image";
import Icon from "@/components/Icon";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type EditProfileProps = {};

const EditProfile = ({}: EditProfileProps) => {
    const [objectURL, setObjectURL] = useState<any>("/images/avatar.jpg");
    const [name, setName] = useState<string>("");
    const [location, setLocation] = useState<string>("Sai Gon, Vietnam");
    const [bio, setBio] = useState<string>("");
    const { t } = useLocale();

    const handleUpload = (e: any) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            // setImage(file);
            setObjectURL(URL.createObjectURL(file));
        }
    };

    return (
        <form className="" action="" onSubmit={(event) => event.preventDefault()}>
            <div className="mb-8 h4 md:mb-6">{t("settings.editProfile.title")}</div>
            <div className="mb-3 base2 font-semibold text-n-6 dark:text-n-1">
                {t("settings.editProfile.avatar")}
            </div>
            <div className="flex items-center mb-6">
                <div className="relative flex justify-center items-center shrink-0 w-28 h-28 mr-4 rounded-full overflow-hidden bg-n-2 dark:bg-n-6">
                    {objectURL !== null ? (
                        <Image
                            className="object-cover rounded-full"
                            src={objectURL}
                            fill
                            alt="Avatar"
                        />
                    ) : (
                        <Icon
                            className="w-8 h-8 dark:fill-n-1"
                            name="profile"
                        />
                    )}
                </div>
                <div className="grow">
                    <div className="relative inline-flex mb-4">
                        <input
                            className="peer absolute inset-0 opacity-0 cursor-pointer"
                            type="file"
                            onChange={handleUpload}
                        />
                        <button className="btn-stroke-light peer-hover:bg-n-3 dark:peer-hover:bg-n-5">
                            {t("settings.editProfile.uploadImage")}
                        </button>
                    </div>
                    <div className="caption1 text-n-4">
                        <p>{t("settings.editProfile.imageHint1")}</p>
                        <p>{t("settings.editProfile.imageHint2")}</p>
                    </div>
                </div>
            </div>
            <Field
                className="mb-6"
                label={t("settings.editProfile.nameLabel")}
                placeholder={t("settings.editProfile.namePlaceholder")}
                icon="profile-1"
                value={name}
                onChange={(e: any) => setName(e.target.value)}
                required
            />
            <Field
                className="mb-6"
                label={t("settings.editProfile.locationLabel")}
                placeholder={t("settings.editProfile.locationPlaceholder")}
                icon="marker"
                value={location}
                onChange={(e: any) => setLocation(e.target.value)}
                required
            />
            <Field
                className="mb-6"
                label={t("settings.editProfile.bioLabel")}
                placeholder={t("settings.editProfile.bioPlaceholder")}
                icon="user-check"
                value={bio}
                onChange={(e: any) => setBio(e.target.value)}
                textarea
                required
            />
            <button className="btn-blue w-full">
                {t("settings.editProfile.saveChanges")}
            </button>
        </form>
    );
};

export default EditProfile;
