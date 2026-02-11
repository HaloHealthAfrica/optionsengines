import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const dateClause = "created_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'";

  const res = await pool.query(
    `SELECT engine, is_shadow, COUNT(*)::int AS count
     FROM decision_recommendations
     WHERE ${dateClause}
     GROUP BY engine, is_shadow
     ORDER BY engine, is_shadow`
  );
  const rejected = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM decision_recommendations
     WHERE ${dateClause}
       AND COALESCE(jsonb_extract_path_text(rationale, 'decision'), '') = 'reject'`
  );
  const rejectionReasons = await pool.query(
    `SELECT COALESCE(jsonb_extract_path_text(rationale, 'rejection_reason'), 'unknown') AS reason,
            COUNT(*)::int AS count
     FROM decision_recommendations
     WHERE ${dateClause}
       AND (rationale ? 'rejection_reason' OR jsonb_extract_path_text(rationale, 'decision') = 'reject')
     GROUP BY reason
     ORDER BY count DESC`
  );
  const policy = await pool.query(
    `SELECT execution_mode, executed_engine, shadow_engine, COUNT(*)::int AS count
     FROM execution_policies
     WHERE ${dateClause}
     GROUP BY execution_mode, executed_engine, shadow_engine
     ORDER BY count DESC`
  );

  console.log(
    JSON.stringify(
      {
        recommendationsByEngine: res.rows,
        rejectedRecommendations: rejected.rows[0]?.count ?? 0,
        rejectionReasons: rejectionReasons.rows,
        executionPolicies: policy.rows,
      },
      null,
      2
    )
  );

  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
