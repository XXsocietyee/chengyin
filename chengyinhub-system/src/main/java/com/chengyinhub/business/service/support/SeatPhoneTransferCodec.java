package com.chengyinhub.business.service.support;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

/**
 * DEC-F12 B 按手机号转赠席位的号码口径(纯函数,可单测)。
 * <ul>
 *   <li>规范化:去空格/横线/括号,去 +86 / 0086 / 86 前缀,只认大陆手机号 1[3-9]xxxxxxxxx;</li>
 *   <li>匹配:HMAC-SHA256(服务端密钥, "seat-phone|" + 规范号) 十六进制小写 —— 明文不落库;</li>
 *   <li>展示:138****0000,只回购票人。</li>
 * </ul>
 */
public final class SeatPhoneTransferCodec {

    private static final String DOMAIN = "seat-phone|";
    public static final int NAME_MAX = 20;

    private SeatPhoneTransferCodec() { }

    /** 不是大陆手机号返回 null。 */
    public static String normalize(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("[\\s\\-()（）]", "");
        if (digits.startsWith("+86")) digits = digits.substring(3);
        else if (digits.startsWith("0086")) digits = digits.substring(4);
        else if (digits.length() == 13 && digits.startsWith("86")) digits = digits.substring(2);
        return digits.matches("1[3-9]\\d{9}") ? digits : null;
    }

    public static String mask(String normalized) {
        if (normalized == null || normalized.length() != 11) return null;
        return normalized.substring(0, 3) + "****" + normalized.substring(7);
    }

    public static String hash(String normalized, String secret) {
        if (normalized == null) return null;
        if (secret == null || secret.isEmpty()) throw new IllegalStateException("席位转赠密钥未配置");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] h = mac.doFinal((DOMAIN + normalized).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(h.length * 2);
            for (byte b : h) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("席位转赠号码索引失败", e);
        }
    }

    /** 称呼:去首尾空白,1..20 个字符,不含控制字符;不合格返回 null。 */
    public static String name(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.isEmpty() || v.codePointCount(0, v.length()) > NAME_MAX) return null;
        for (int i = 0; i < v.length(); i++) if (Character.isISOControl(v.charAt(i))) return null;
        return v;
    }
}
