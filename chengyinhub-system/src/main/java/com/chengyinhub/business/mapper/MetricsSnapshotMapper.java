package com.chengyinhub.business.mapper;

import java.util.Date;
import com.chengyinhub.business.domain.MetricsSnapshot;

/** D12 指标快照 Mapper。 */
public interface MetricsSnapshotMapper {
    int upsertSnapshot(MetricsSnapshot snapshot);

    Date selectLatestSuccessfulSampledAt();

    /** 审计 D2：删 cutoff 之前采样的快照，走 idx_metrics_snapshot_sampled_at，最多 limit 行。 */
    int deleteSnapshotsBefore(@org.apache.ibatis.annotations.Param("cutoff") java.util.Date cutoff,
                              @org.apache.ibatis.annotations.Param("limit") int limit);
}
