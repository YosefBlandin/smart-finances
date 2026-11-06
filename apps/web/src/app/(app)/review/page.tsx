import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { dataKeys } from '@/queries/keys';
import { Review } from '@/screens/review/Review';
import styles from '@/screens/review/Review.module.css';
import { redirectIfLimited } from '../../api/data/respond';
import { requireMoneyAccess } from '../../guarded';
import { chooseReview } from './actions';
import { readReview } from './read';

// To review (SF-166; AC-8, D-131): the server reads the rows to review (the same read the shell's count made, so one
// counted request) and hydrates the island with them; past the person limit, the limit page (AC-17). A failed read is
// left out, so the island asks again and says so if it fails. Choices go through the chooseReview server action. The
// heading comes first and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const t = await getTranslations();
  const intro = (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('nav.review')}
      </h1>
      <p className={styles.sub}>{t('review.sub')}</p>
    </>
  );
  // The money layout already checked the session; this read only hands the page the person's token.
  const access = await requireMoneyAccess();
  if (!access.ok) return intro;

  const review = await readReview(access.session.accessToken);
  if (!review.ok) redirectIfLimited(review);
  const client = new QueryClient();
  if (review.ok) client.setQueryData(dataKeys.review(), review.data);
  return (
    <>
      {intro}
      <HydrationBoundary state={dehydrate(client)}>
        <Review choose={chooseReview} />
      </HydrationBoundary>
    </>
  );
}
