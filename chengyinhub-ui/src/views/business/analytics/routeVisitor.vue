<template>
  <div>
    <el-form :inline="true" size="small" @submit.native.prevent>
      <el-form-item label="主题">
        <el-select
          v-model="query.topicId"
          filterable
          remote
          :remote-method="searchTopics"
          :loading="topicLoading"
          placeholder="搜索主题名称"
          style="width: 260px"
        >
          <el-option v-for="t in topicOptions" :key="t.id" :label="t.name + '（#' + t.id + '）'" :value="t.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="yyyy-MM-dd"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :clearable="false"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" :loading="loading" :disabled="!ready" @click="load">查询</el-button>
        <el-button icon="el-icon-download" :disabled="!report" :loading="exporting" @click="handleExport">导出 CSV</el-button>
      </el-form-item>
    </el-form>

    <p v-if="error" class="rv-error">{{ error }} <el-button type="text" @click="load">重试</el-button></p>
    <template v-else-if="report">
      <dl class="rv-facts">
        <div><dt>主题</dt><dd>{{ report.topicName || ('#' + report.topicId) }}</dd></div>
        <div><dt>日期</dt><dd>{{ report.startDate }} – {{ report.endDate }}（{{ report.timeZone }}）</dd></div>
        <div><dt>开局来源</dt><dd>{{ report.runsSource === 'TOPIC_ROUTE_SESSION' ? '路线局' : '无路线局（未知）' }}</dd></div>
        <div><dt>测试数据</dt><dd>{{ report.testExclusionBasis && report.testExclusionBasis.indexOf('NO_SERVER_MARKER') === 0 ? '未排除（无服务端标记）' : report.testExclusionBasis }}</dd></div>
      </dl>

      <h3 class="rv-title">路线按天</h3>
      <el-table :data="routeRows" size="small" max-height="420">
        <el-table-column label="日期" prop="date" min-width="120" />
        <el-table-column label="开局" width="90"><template slot-scope="s">{{ cell(s.row.runsStarted) }}</template></el-table-column>
        <el-table-column label="完局" width="90"><template slot-scope="s">{{ cell(s.row.runsCompleted) }}</template></el-table-column>
        <el-table-column label="平均用时（分钟）" width="140"><template slot-scope="s">{{ cell(s.row.avgDurationMinutes) }}</template></el-table-column>
        <el-table-column label="玩家" width="90"><template slot-scope="s">{{ cell(s.row.players) }}</template></el-table-column>
        <el-table-column label="退款" width="90"><template slot-scope="s">{{ cell(s.row.refunds) }}</template></el-table-column>
      </el-table>

      <h3 class="rv-title">站点合计</h3>
      <el-table :data="report.stations || []" size="small" empty-text="该主题没有站点">
        <el-table-column label="站点" prop="stationName" min-width="160" show-overflow-tooltip />
        <el-table-column label="到访" width="90"><template slot-scope="s">{{ cell(s.row.arrivals) }}</template></el-table-column>
        <el-table-column label="完成" width="90"><template slot-scope="s">{{ cell(s.row.completions) }}</template></el-table-column>
        <el-table-column label="商家核销" width="100"><template slot-scope="s">{{ cell(s.row.verifications) }}</template></el-table-column>
        <el-table-column label="权益兑换" width="100"><template slot-scope="s">{{ cell(s.row.perkRedemptions) }}</template></el-table-column>
        <el-table-column label="玩家" width="90"><template slot-scope="s">{{ cell(s.row.players) }}</template></el-table-column>
        <el-table-column label="无日期完成（全期）" width="150"><template slot-scope="s">{{ cell(s.row.undatedCompletions) }}</template></el-table-column>
      </el-table>

      <h3 class="rv-title">站点按天</h3>
      <el-table :data="report.stationDays || []" size="small" max-height="520" empty-text="所选日期内没有站点事实">
        <el-table-column label="日期" prop="date" width="120" />
        <el-table-column label="站点" prop="stationName" min-width="160" show-overflow-tooltip />
        <el-table-column label="到访" width="90"><template slot-scope="s">{{ cell(s.row.arrivals) }}</template></el-table-column>
        <el-table-column label="完成" width="90"><template slot-scope="s">{{ cell(s.row.completions) }}</template></el-table-column>
        <el-table-column label="商家核销" width="100"><template slot-scope="s">{{ cell(s.row.verifications) }}</template></el-table-column>
        <el-table-column label="权益兑换" width="100"><template slot-scope="s">{{ cell(s.row.perkRedemptions) }}</template></el-table-column>
        <el-table-column label="玩家" width="90"><template slot-scope="s">{{ cell(s.row.players) }}</template></el-table-column>
      </el-table>
    </template>
  </div>
</template>

<script>
import { saveAs } from 'file-saver'
import { getRouteVisitorReport, exportRouteVisitorReport } from '@/api/business/analytics'
import { listTopic } from '@/api/business/topic'
import { blobValidate } from '@/utils/ruoyi'

function isoDay(date) {
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

export default {
  name: 'RouteVisitorReport',
  data() {
    const end = new Date()
    const start = new Date(end.getTime() - 29 * 24 * 3600 * 1000)
    return {
      query: { topicId: null },
      range: [isoDay(start), isoDay(end)],
      topicOptions: [],
      topicLoading: false,
      topicSearchSeq: 0,
      loading: false,
      exporting: false,
      error: '',
      report: null
    }
  },
  computed: {
    ready() {
      return !!(this.query.topicId && this.range && this.range.length === 2)
    },
    params() {
      return { topicId: this.query.topicId, startDate: this.range[0], endDate: this.range[1] }
    },
    routeRows() {
      if (!this.report) return []
      return (this.report.routeDays || []).concat(this.report.routeTotal ? [this.report.routeTotal] : [])
    }
  },
  methods: {
    // 未知（null）显示破折号，不显示 0；"<3" 原样显示。
    cell(value) {
      return value === null || value === undefined ? '—' : value
    },
    searchTopics(keyword) {
      const seq = ++this.topicSearchSeq
      if (!keyword) { this.topicOptions = []; return }
      this.topicLoading = true
      listTopic({ name: keyword, pageNum: 1, pageSize: 20 })
        .then(res => { if (seq === this.topicSearchSeq) this.topicOptions = (res.rows || []).filter(t => t && t.id) })
        .catch(() => {
          if (seq !== this.topicSearchSeq) return
          this.topicOptions = []
          this.$modal.msgError('主题搜索失败，请重试')
        })
        .finally(() => { if (seq === this.topicSearchSeq) this.topicLoading = false })
    },
    load() {
      if (!this.ready) return
      this.loading = true
      this.error = ''
      getRouteVisitorReport(this.params).then(res => {
        this.report = res.data || null
      }).catch(e => {
        this.report = null
        this.error = (e && e.message) || '报告读取失败'
      }).finally(() => {
        this.loading = false
      })
    },
    handleExport() {
      if (!this.report) return
      const p = { topicId: this.report.topicId, startDate: this.report.startDate, endDate: this.report.endDate }
      this.exporting = true
      exportRouteVisitorReport(p).then(async data => {
        if (blobValidate(data)) {
          saveAs(new Blob([data]), `route_visitor_${p.topicId}_${p.startDate}_${p.endDate}.csv`)
        } else {
          const body = JSON.parse(await data.text())
          this.$modal.msgError(body.msg || '导出失败')
        }
      }).catch(() => {
        this.$modal.msgError('导出失败，请重试')
      }).finally(() => {
        this.exporting = false
      })
    }
  }
}
</script>

<style scoped>
.rv-error { color: #f56c6c; }
.rv-title { margin: 18px 0 8px; font-size: 15px; }
.rv-facts { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0 0 8px; font-size: 13px; }
.rv-facts div { display: flex; gap: 6px; }
.rv-facts dt { color: #909399; }
.rv-facts dd { margin: 0; }
</style>
