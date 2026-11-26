<template>
  <div class="app-container">
    <el-tabs v-model="activeTab">
    <el-tab-pane label="增长漏斗" name="funnel">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" label-width="80px">
      <el-form-item label="开始日期" prop="startDate">
        <el-date-picker
          v-model="queryParams.startDate"
          type="date"
          value-format="yyyy-MM-dd"
          placeholder="选择开始日期"
          clearable
        />
      </el-form-item>
      <el-form-item label="结束日期" prop="endDate">
        <el-date-picker
          v-model="queryParams.endDate"
          type="date"
          value-format="yyyy-MM-dd"
          placeholder="选择结束日期"
          clearable
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="funnelList" empty-text="暂无漏斗数据">
      <el-table-column label="日期" align="center" prop="statDate" width="130" />
      <el-table-column label="事件" align="center" prop="stepName" min-width="160" />
      <el-table-column label="业务类型" align="center" prop="bizType" width="120" />
      <el-table-column label="城市" align="center" prop="cityCode" width="120" />
      <el-table-column label="人数" align="center" prop="memberCount" width="120" />
      <el-table-column label="次数" align="center" prop="eventCount" width="120" />
      <el-table-column label="转化率" align="center" prop="conversionRate" width="120" />
    </el-table>

    <h4>路线购买与游玩</h4>
    <el-table v-loading="routeLoading" :data="routeRows" empty-text="暂无路线漏斗数据">
      <el-table-column label="日期" align="center" prop="statDate" width="110" />
      <el-table-column label="主题" align="center" prop="topicName" min-width="140" />
      <el-table-column label="详情人数" align="center" prop="detailViewMembers" />
      <el-table-column label="结账人数" align="center" prop="checkoutOpenMembers" />
      <el-table-column label="下单" align="center" prop="orderCreatedFacts" />
      <el-table-column label="支付" align="center" prop="paidFacts" />
      <el-table-column label="现金支付" align="center" prop="paidCashFacts" />
      <el-table-column label="开玩人数" align="center" prop="playStartedMembers" />
      <el-table-column label="完赛人数" align="center" prop="completedMembers" />
      <el-table-column label="退款" align="center" prop="refundedFacts" />
    </el-table>

    <h4>30 日复购</h4>
    <el-descriptions v-loading="repeatLoading" :column="4" border size="small">
      <el-descriptions-item label="有效付费">{{ repeatText(repeat && repeat.primary) }}</el-descriptions-item>
      <el-descriptions-item label="全部报名">{{ repeatText(repeat && repeat.allSignups) }}</el-descriptions-item>
      <el-descriptions-item label="未成熟">{{ repeat ? repeat.primary.immatureCount + ' / ' + repeat.allSignups.immatureCount : '未知' }}</el-descriptions-item>
      <el-descriptions-item label="数据截至">{{ repeat ? repeat.dataCutoffAt + ' · ' + repeat.definitionVersion : '未知' }}</el-descriptions-item>
    </el-descriptions>
    </el-tab-pane>
    <el-tab-pane label="路线到访" name="routeVisitor" lazy>
      <route-visitor-report />
    </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import { listFunnel, getRouteFunnel, getRepeatSignup } from '@/api/business/analytics'
import RouteVisitorReport from './routeVisitor'

export default {
  name: 'BusinessAnalytics',
  components: { RouteVisitorReport },
  data() {
    return {
      activeTab: 'funnel',
      loading: false,
      funnelList: [],
      routeLoading: false,
      routeRows: [],
      repeatLoading: false,
      repeat: null,
      queryParams: {
        startDate: null,
        endDate: null
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    getList() {
      this.loading = true
      listFunnel(this.queryParams).then(response => {
        const data = response.data || {}
        this.funnelList = data.rows || []
      }).finally(() => {
        this.loading = false
      })
      this.routeLoading = true
      getRouteFunnel(this.queryParams).then(response => {
        this.routeRows = (response.data && response.data.rows) || []
      }).catch(() => {
        this.routeRows = []
      }).finally(() => {
        this.routeLoading = false
      })
      this.repeatLoading = true
      this.repeat = null
      getRepeatSignup({ cohortStart: this.queryParams.startDate, cohortEnd: this.queryParams.endDate }).then(response => {
        this.repeat = response.data || null
      }).catch(() => {
        this.repeat = null
      }).finally(() => {
        this.repeatLoading = false
      })
    },
    // 分母为 0 或读取失败都显示「未知」，不显示 0%。
    repeatText(figure) {
      if (!figure || figure.rate === null || figure.rate === undefined) {
        return figure ? figure.numerator + ' / ' + figure.denominator + '（未知）' : '未知'
      }
      return figure.numerator + ' / ' + figure.denominator + '（' + (figure.rate * 100).toFixed(1) + '%）'
    },
    handleQuery() {
      this.getList()
    },
    resetQuery() {
      this.resetForm('queryForm')
      this.handleQuery()
    }
  }
}
</script>
