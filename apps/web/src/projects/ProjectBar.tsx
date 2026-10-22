import { useT } from '../i18n/useT.ts';

interface Props {
  projectId: string | null;
  projectName: string;
  /** 未保存の変更があるか */
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  /** 他の人が編集中で、閲覧のみになっているか */
  readOnly: boolean;
  /** 案件の一覧へ戻る */
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
  onList,
  onRename,
  onSave,
}: Props) {
  const t = useT();
  return (
    <div className="projectbar">
      <button type="button" className="picker" onClick={onList}>
        ☰ {t('project.list')}
      </button>

      {projectId && (
        <>
          <b className="jobname">{projectName}</b>
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
            {saving ? t('project.saving') : dirty ? t('project.save') : t('project.saved')}
          </button>
          <span className="saved">
            {readOnly
              ? t('project.readonly')
              : dirty
                ? t('project.hasUnsaved')
                : savedAt
                  ? `${new Date(savedAt).toLocaleTimeString()} ${t('project.savedAt')}`
                  : ''}
          </span>
        </>
      )}
    </div>
  );
}
