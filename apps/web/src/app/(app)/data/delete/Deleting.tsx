import { getTranslations } from 'next-intl/server';
import states from '../../../states.module.css';
import { finishDeletion } from './actions';
import { FinishDeleting } from './FinishDeleting';

// The deleting screen (SF-169; AC-18, architecture "States and exits", deleting account): the money layout shows it in
// place of any money screen while the signed-in person's account is marked deleting, after a reload or on another
// screen, so the deletion that the full re-sign-in started can be finished from any live session of the person
// (finishDeletion, allowDeleting). No shell and no money data: the account is closing.
export async function Deleting() {
  const t = await getTranslations('auth');
  return (
    <main className={states.page}>
      <div className={states.card}>
        <p className={states.brand}>cuenta</p>
        <h1 className={states.title} tabIndex={-1}>
          {t('delete.unfinishedTitle')}
        </h1>
        <p className={states.lead}>{t('delete.unfinished')}</p>
        <FinishDeleting finish={finishDeletion} />
      </div>
    </main>
  );
}
