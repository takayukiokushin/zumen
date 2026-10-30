import { useLang, useT } from '../i18n/useT.ts';

interface Props {
  projectId: string | null;
  projectName: string;
  /** 未保存の変更があるか */
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  /** 他の人が編集中で、閲覧のみになっているか */
  readOnly: boolean;
  /** 一覧を開いているか（押すと、開閉が切り替わる） */
  listing: boolean;
  /** 案件の一覧を開く・閉じる */
  onList: () => void;
  onRename: (name: string) => void;
  onSave: () => void;
}

/** 開いている案件の名前・保存の帯。利用者まわりは上のタブ帯に移した（㉙） */
export function ProjectBar({
  projectId,
  projectName,
  dirty,
  saving,
  savedAt,
  readOnly,
  listing,
  onList,
  onRename,
  onSave,
}: Props) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="projectbar">
      <button type="button" className="picker" aria-pressed={listing} onClick={onList}>
        ☰ {t('project.list')}
      </button>

      {projectId && (
        <>
          {/* 長い名前でもボタンに重ならないよう、はみ出す分は「…」で省く（全文はツールチップ） */}
          <b className="jobname" title={projectName}>
            <span className="jobname-label">{t('project.nameLabel')}</span>
            {projectName}
          </b>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              const name = window.prompt(t('project.name'), projectName);
              if (name) onRename(name);
            }}
          >
            {t('project.rename')}
          </button>
          <button
            type="button"
            className={dirty ? 'need-save' : ''}
            onClick={onSave}
            disabled={saving || !dirty || readOnly}
          >
            {/* 名前は、いつも「保存」。保存したあとは、押せなくなるだけ（横に、保存した時刻が出る） */}
            {t('project.save')}
          </button>
          <span className="saved">
            {readOnly
              ? t('project.readonly')
              : saving
                ? t('project.saving')
                : dirty
                  ? t('project.hasUnsaved')
                  : savedAt
                    ? `${new Date(savedAt).toLocaleTimeString(lang)} ${t('project.savedAt')}`
                    : ''}
          </span>
        </>
      )}
    </div>
  );
}
