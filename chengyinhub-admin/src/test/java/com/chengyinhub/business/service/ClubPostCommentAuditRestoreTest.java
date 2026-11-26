package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.AuditTask;
import com.chengyinhub.business.domain.ClubPostComment;
import com.chengyinhub.business.domain.dto.AuditReviewDTO;
import com.chengyinhub.business.mapper.AuditRecordMapper;
import com.chengyinhub.business.mapper.AuditTaskMapper;
import com.chengyinhub.business.mapper.BusinessAuditEventMapper;
import com.chengyinhub.business.mapper.ClubPostCommentMapper;
import com.chengyinhub.business.service.impl.AuditTaskServiceImpl;
import com.chengyinhub.business.service.impl.ClubPostCommentServiceImpl;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 俱乐部动态评论「举报不成立 → 恢复」整条链路:审核结论 → applyModeration → ClubPostCommentServiceImpl
 * → 真 ClubPostCommentMapper.xml → 表。曾因 updateClubPostComment 引用不存在的 likeCount/like_count,
 * MyBatis 取属性即抛错,而 applyModeration 对俱乐部评论是 best-effort 只记日志 ⇒ 审核显示「举报不成立」,评论却永远停在下架态。
 */
class ClubPostCommentAuditRestoreTest {

    private static final long COMMENT = 31L;

    private DriverManagerDataSource dataSource;
    private JdbcTemplate jdbc;
    private SqlSession session;
    private AuditTaskMapper taskMapper;
    private AuditTaskServiceImpl service;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.h2.Driver");
        dataSource.setUrl("jdbc:h2:mem:club_comment_restore_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        dataSource.setUsername("sa");
        jdbc = new JdbcTemplate(dataSource);
        // 列形状取自 sql/base_schema_20260818.sql 的 club_post_comment(该表没有 like_count)
        jdbc.execute("create table club_post_comment (id bigint auto_increment primary key, post_id bigint not null,"
                + " member_id bigint not null, content varchar(1000), del_flag int default 0, create_time datetime)");
        jdbc.update("insert into club_post_comment(id, post_id, member_id, content, del_flag) values (?, 7, 8, '好看', 2)", COMMENT);

        session = factory().openSession(true);
        ClubPostCommentServiceImpl comments = new ClubPostCommentServiceImpl();
        ReflectionTestUtils.setField(comments, "clubPostCommentMapper", session.getMapper(ClubPostCommentMapper.class));

        taskMapper = mock(AuditTaskMapper.class);
        AuditRecordMapper recordMapper = mock(AuditRecordMapper.class);
        BusinessAuditEventMapper auditMapper = mock(BusinessAuditEventMapper.class);
        service = new AuditTaskServiceImpl();
        ReflectionTestUtils.setField(service, "auditTaskMapper", taskMapper);
        ReflectionTestUtils.setField(service, "auditRecordMapper", recordMapper);
        ReflectionTestUtils.setField(service, "businessAuditEventMapper", auditMapper);
        ReflectionTestUtils.setField(service, "clubPostCommentService", comments);
        when(recordMapper.insertAuditRecord(any())).thenReturn(1);
        when(auditMapper.insertBusinessAuditEvent(any())).thenReturn(1);

        AuditTask task = new AuditTask();
        task.setId(9L);
        task.setBizType(AuditTask.BIZ_CLUB_POST_COMMENT);
        task.setBizId(COMMENT);
        task.setStatus(AuditTask.STATUS_PENDING);
        task.setVersion(0);
        when(taskMapper.selectAuditTaskById(9L)).thenReturn(task);
        when(taskMapper.updateAuditTaskReviewCas(anyLong(), anyInt(), anyInt(), anyLong(), anyInt(), any())).thenReturn(1);
    }

    @AfterEach
    void tearDown() {
        if (session != null) session.close();
    }

    @Test
    void reportDismissedRestoresTheTakenDownComment() {
        AuditReviewDTO decision = new AuditReviewDTO();
        decision.setStatus(AuditTask.STATUS_APPROVED);

        service.review(9L, 1L, decision);

        assertEquals(0, delFlag(), "举报不成立必须把评论从 del_flag=2 恢复为 0");
    }

    @Test
    void reportUpheldKeepsTheCommentTakenDown() {
        jdbc.update("update club_post_comment set del_flag = 0 where id = ?", COMMENT);
        AuditReviewDTO decision = new AuditReviewDTO();
        decision.setStatus(AuditTask.STATUS_REJECTED);
        decision.setReasonText("违规");

        service.review(9L, 1L, decision);

        assertEquals(2, delFlag());
    }

    @Test
    void mapperRestoreOnlyTouchesExistingColumns() {
        ClubPostCommentMapper mapper = session.getMapper(ClubPostCommentMapper.class);
        ClubPostComment restore = new ClubPostComment();
        restore.setId(COMMENT);
        restore.setDelFlag(0);
        assertEquals(1, mapper.updateClubPostComment(restore));
        assertEquals(0, delFlag());
        assertEquals("好看", jdbc.queryForObject("select content from club_post_comment where id = ?", String.class, COMMENT),
                "只传 delFlag 时不能动 content");
    }

    private int delFlag() {
        return jdbc.queryForObject("select del_flag from club_post_comment where id = ?", Integer.class, COMMENT);
    }

    private SqlSessionFactory factory() throws Exception {
        Configuration configuration = new Configuration(new Environment(
                "club-post-comment", new JdbcTransactionFactory(), dataSource));
        configuration.getTypeAliasRegistry().registerAlias("ClubPostComment", ClubPostComment.class);
        configuration.addMapper(ClubPostCommentMapper.class);
        String resource = "mapper/business/ClubPostCommentMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("missing " + resource);
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
