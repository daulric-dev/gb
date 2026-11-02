"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { organisationSchoolPath } from "@/lib/organisation";
import { ssoProviderName, type SsoProvider } from "@/lib/sso";
import type { OrganisationDomain } from "@/lib/sign-in-providers";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Every school's email domains at a glance, each linking to its school's
 * single sign-on section. Hidden until a school has a domain.
 */
export function SchoolDomains() {
  const [domains, setDomains] = useState<OrganisationDomain[] | null>(null);
  const [providers, setProviders] = useState<SsoProvider[]>([]);

  useEffect(() => {
    api<OrganisationDomain[]>("/organisation/sign-in/domains")
      .then((list) => setDomains(Array.isArray(list) ? list : []))
      .catch(() => setDomains([]));
    api<SsoProvider[]>("/auth/sso/providers")
      .then((list) => setProviders(Array.isArray(list) ? list : []))
      .catch(() => setProviders([]));
  }, []);

  if (!domains || domains.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email domains &amp; single sign-on</CardTitle>
        <CardDescription>
          Open a school to change its domains and how each one signs in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link
                    href={`${organisationSchoolPath(d.schoolId)}#single-sign-on`}
                    className="font-medium hover:underline"
                  >
                    {d.schoolName}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{d.domain}</TableCell>
                <TableCell>
                  {d.verified ? (
                    <Badge variant="secondary">Verified</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {d.ssoProvider ? (
                    ssoProviderName(
                      providers.find((p) => p.id === d.ssoProvider),
                      d.ssoProvider,
                    )
                  ) : (
                    <span className="text-muted-foreground">Email codes</span>
                  )}
                </TableCell>
                <TableCell>{d.ssoRequired ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
