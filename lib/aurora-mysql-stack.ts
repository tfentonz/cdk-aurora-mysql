import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  aws_ec2 as ec2,
  aws_rds as rds,
  aws_logs as logs,
  aws_route53 as route53,
} from 'aws-cdk-lib';

export class AuroraMysqlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('172.0.0.0/16'),
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 20,
          reserved: true,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 20,
        },
      ],
      restrictDefaultSecurityGroup: true,
    });

    const clusterSecurityGroup = new ec2.SecurityGroup(this, 'ClusterSecurityGroup', {
      description: 'Security group for Aurora MySQL cluster',
      vpc,
    });

    const clusterParameterGroup = new rds.ParameterGroup(this, 'Cluster ParameterGroup', {
      description: 'Cluster parameter group for Aurora MySQL 5.7',
      engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_2_12_0 }),
      parameters: {
        explicit_default_for_timestamp: '0',
        log_bin_trust_function_creators: '1',
        log_output: 'FILE',
        long_query_time: '10.000000',
        slow_query_log: '1',
        tls_version: 'TLSv1.1,TLSv1.2',
      },
    });

    const cluster = new rds.DatabaseCluster(this, 'Cluster', {
      backtrackWindow: cdk.Duration.days(1),
      copyTagsToSnapshot: true,
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_2_12_0 }),
      backup: {
        retention: cdk.Duration.days(7),
      },
      deletionProtection: true,
      monitoringInterval: cdk.Duration.seconds(60),
      parameterGroup: clusterParameterGroup,
      securityGroups: [clusterSecurityGroup],
      storageEncrypted: true,
      writer: rds.ClusterInstance.provisioned('Writer', {
        caCertificate: rds.CaCertificate.RDS_CA_RDS2048_G1,
        enablePerformanceInsights: true,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
      }),
      readers: [
        rds.ClusterInstance.provisioned('Reader1', {
          caCertificate: rds.CaCertificate.RDS_CA_RDS2048_G1,
          enablePerformanceInsights: true,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
        }),
      ],
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnetGroupName: 'Private' }),
    });

    // #region Route 53
    const hostedZone = new route53.PrivateHostedZone(this, 'PrivateHostedZone', {
      vpc,
      zoneName: 'internal',
    });

    new route53.CnameRecord(this, 'MysqlCnameRecord', {
      domainName: cluster.clusterEndpoint.hostname,
      zone: hostedZone,
      recordName: 'mysql.internal.',
      ttl: cdk.Duration.hours(12),
    });

    new route53.CnameRecord(this, 'MysqlReadCnameRecord', {
      domainName: cluster.clusterReadEndpoint.hostname,
      zone: hostedZone,
      recordName: 'mysql-ro.internal.',
      ttl: cdk.Duration.hours(12),
    });
   // #endregion
  }
}
