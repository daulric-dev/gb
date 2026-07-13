import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/lib/api";
import { capitalize } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";
import type { AttendanceStatus } from "@/lib/types";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

interface SummaryResponse {
  counts: { present: number; absent: number; late: number; total: number };
  presentPercentage: number;
}

interface RangeRecord {
  id: string;
  date: string;
  status: AttendanceStatus;
  notes: string | null;
}

type RangeKey = "7" | "30" | "90";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const STAT_COLORS: Record<AttendanceStatus, string> = {
  present: "#059669",
  late: "#f59e0b",
  absent: "#e11d48",
};

/** Per-student attendance summary + recent records over a selectable range. */
export function StudentAttendanceReport({
  classId,
  studentId,
}: {
  classId: string;
  studentId: string;
}) {
  const { colors } = useTheme();
  const [range, setRange] = useState<RangeKey>("30");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [records, setRecords] = useState<RangeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(() => {
    const from = isoDaysAgo(Number(range));
    const to = todayIso();
    setLoading(true);
    Promise.all([
      api<SummaryResponse>(
        `/classes/${classId}/attendance/students/${studentId}/summary?from=${from}&to=${to}`,
      ),
      api<{ records: RangeRecord[] }>(
        `/classes/${classId}/attendance/students/${studentId}?from=${from}&to=${to}`,
      ),
    ])
      .then(([s, r]) => {
        setSummary(s);
        setRecords(r.records);
      })
      .catch(() => {
        setSummary(null);
        setRecords([]);
      })
      .finally(() => setLoading(false));
  }, [classId, studentId, range]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <View style={{ gap: 16 }}>
      <SegmentedControl<RangeKey>
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
        ]}
      />

      {loading ? (
        <Skeleton style={{ height: 72, borderRadius: 12 }} />
      ) : summary && summary.counts.total > 0 ? (
        <View
          style={[
            styles.counts,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          <Stat label="Present" value={summary.counts.present} />
          <Stat label="Late" value={summary.counts.late} />
          <Stat label="Absent" value={summary.counts.absent} />
          <Stat
            label="Attended"
            value={`${summary.presentPercentage.toFixed(0)}%`}
          />
        </View>
      ) : (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text variant="muted" style={{ textAlign: "center" }}>
            No attendance recorded in this range.
          </Text>
        </View>
      )}

      {!loading && records.length > 0 ? (
        <View style={{ gap: 8 }}>
          {records.map((r) => (
            <View
              key={r.id}
              style={[styles.record, { borderBottomColor: colors.border }]}
            >
              <Text style={{ flex: 1 }}>{r.date}</Text>
              <Badge variant="outline" color={STAT_COLORS[r.status]}>
                {capitalize(r.status)}
              </Badge>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="muted" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <Text weight="700" style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  counts: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
  },
  record: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
