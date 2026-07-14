import { useApi } from "../hooks/useApi.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatCard, StatGrid } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { money, dateShort } from "../lib/format.ts";

interface Row {
  company: string;
  occurredAt: string;
  product: string;
  amount: number;
  rate: number;
  commission: number;
  status: string;
}
interface MyReferrals {
  rows: Row[];
  totals: { customers: number; transactions: number; revenue: number; commission: number };
}

/** An advisor's OWN SmartPlan referral earnings: which referred customers subscribed
 *  and the commission they've earned — the advisor-facing counterpart to the
 *  super-admin referral reports. Self-scoped by the API to the logged-in advisor. */
export default function MyEarningsPage() {
  const { data, loading, error } = useApi<MyReferrals>("/api/reports/my-referrals");
  const foot = { fontWeight: 700, borderTop: "2px solid var(--color-border)" };

  return (
    <div>
      <PageHead title="My Earnings" subtitle="Your referred customers who subscribed, and the commission you've earned" />
      <ErrorBanner message={error} />
      {loading || !data ? (
        <Spinner />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Customers Subscribed" value={data.totals.customers} icon={<Icon name="users" />} />
            <StatCard label="Referral Revenue" value={money(data.totals.revenue)} sub={`${data.totals.transactions} payments`} icon={<Icon name="reports" />} />
            <StatCard label="Commission Earned" value={money(data.totals.commission)} icon={<Icon name="commission" />} />
          </StatGrid>

          <Card>
            <h3>Referral Transactions</h3>
            <p className="muted" style={{ marginBottom: ".75rem" }}>
              Each subscription payment from a customer who registered through your referral link, with the commission at the rate effective on that date.
            </p>
            {data.rows.length === 0 ? (
              <EmptyState
                icon="commission"
                title="No referral earnings yet"
                hint="When a customer registers through your referral link and subscribes, it will appear here."
              />
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Product</th>
                      <th className="num">Amount</th>
                      <th className="num">Rate</th>
                      <th className="num">Commission</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.company}</td>
                        <td>{dateShort(r.occurredAt)}</td>
                        <td>{r.product}</td>
                        <td className="num">{money(r.amount)}</td>
                        <td className="num">{r.rate}%</td>
                        <td className="num">{money(r.commission)}</td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={foot}>{data.totals.transactions} payments</td>
                      <td style={foot} />
                      <td style={foot} />
                      <td className="num" style={foot}>{money(data.totals.revenue)}</td>
                      <td style={foot} />
                      <td className="num" style={foot}>{money(data.totals.commission)}</td>
                      <td style={foot} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
