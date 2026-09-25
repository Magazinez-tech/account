import { Link } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import type { Company, SalesDocument } from '../api';
import { Alert, Button, Loading } from '../ui';
import { useApi } from '../useApi';
import SalesDocumentPaper from './SalesDocumentPaper';

export default function TaxInvoicePage() {
  const { id } = useParams();
  const { data: doc, error: loadError } = useApi<SalesDocument>(`/billing-notes/${id}`);
  const { data: company } = useApi<Company>('/company');

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!doc) return <Loading />;

  if (doc.status !== 'paid') {
    return (
      <div className="py-8 text-center text-slate-600">
        ออกใบกำกับภาษี / ใบเสร็จรับเงินได้เฉพาะใบวางบิลที่ชำระแล้ว
        <Link to={`/billing-notes/${id}`} className="ml-2 font-medium text-emerald-800 underline">
          กลับไปที่ใบวางบิล
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3 print:hidden">
        <Link to={`/billing-notes/${id}`} className="text-sm text-slate-600 hover:text-slate-900 underline">
          ← ใบวางบิล {doc.docNo}
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          พิมพ์ / PDF
        </Button>
      </div>
      <SalesDocumentPaper doc={doc} company={company ?? null} taxInvoice />
    </>
  );
}
